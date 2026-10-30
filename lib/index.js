/**
 * dsh-ask-first —— Host 半边。
 *
 * 职责：把「用户说的一小句话」变成「一条说清楚的需求」，中间替用户问几个关键问题。
 * 客户端那半边只负责界面与回填输入框，所有模型调用都在这里。
 *
 * 暴露两条 loopback-only 的 POST 路由：
 *   POST /api/dsh-ask-first/ask     { draft }          → { ok, value: { guess, questions[] } }
 *   POST /api/dsh-ask-first/rewrite { draft, answers }  → { ok, value: { text } }
 *   POST /api/dsh-ask-first/health                      → { ok, value: { llm, provider, model } }
 *
 * 设计要点：
 * - provider/model 优先取 agentDefaultModel.currentSelection()（就是输入框右下角显示的那个），
 *   取不到就整对省略，让 ctx.llm.stream 回退到「最近一次请求的目标」。
 * - 模型输出要求是严格 JSON；解不出来时退化为纯文本，不抛错给用户看红字。
 * - 全程 streaming 累加 text-delta，不用一次性接口。
 */

export const name = "ask-first";
export const inject = ["webServer"];

const API_PREFIX = "/api/dsh-ask-first";
const MAX_BODY = 64 * 1024;
const MAX_DRAFT = 8000;

/* ------------------------------------------------------------------ 提示词 */

/** 每题都固定追加的那个逃生选项：用户答不上来时也不用打字。 */
const NO_IDEA = "我不知道，你替我定";

const ASK_SYSTEM = `你是一个需求澄清助手。用户想请 AI 帮忙做事，但常常一口气说不清，甚至不知道该怎么说。

你的任务：读用户这句话，先复述你听懂的部分，再问出最关键的 2-3 个问题——并且保证用户**只点一下就能答完**，一个字都不用打。

硬性要求：
- 每个问题都必须能明显改变最终结果。问「你想要什么风格」这种万金油没用。
- 每个问题**至少给 3 个**候选答案，具体、互相区别明显，覆盖最可能的几种情况。
- 每个问题的最后一个选项固定就是「${NO_IDEA}」这句话，一个字都不要改，也不要往它后面再加选项。
- 问题要短（15 字以内），选项要短（12 字以内）。
- 用用户说话的语言（用户说中文就用中文）。
- 不要问用户已经说了的内容。
- guess 字段：用一句话复述「我理解你想要的是……」，要具体，不要「你想让我帮忙处理一下」这种空话。这句话是用户判断你有没有听懂的唯一依据，务必写实。

只输出 JSON，不要 markdown 代码块，不要任何解释：
{"guess":"我理解你想要的是……","questions":[{"id":"q1","question":"问题？","options":["选项A","选项B","选项C"]}]}`;

const REWRITE_SYSTEM = `你是一个需求撰写助手。你要把用户原本含糊的一句话，加上他刚才的选择，写成一条**AI 能直接开工的完整需求**。

写法要求：
- 保留用户的原意，绝不擅自扩大或改变他的目标。
- 结构清楚但不要小作文：先用一句话说清目标，再分条列关键约束（做什么、做到什么程度、什么算完成）。
- 把用户的选择当作硬约束写进去。
- 用户选了「${NO_IDEA}」的那一项，说明他没意见：由你按最稳妥的常见做法替他定一个，并在这条约束后面用括号写明「（我替你定的，可以改）」。不要因为这一项就停下来追问。
- 用户没提到、但又必须的信息，不要编造具体值；写成方括号占位，例如 [待补充：目标平台]。
- 用用户说话的语言。
- 长度控制在 400 字以内，能一屏看完。不要用「好的」「当然」这类客套开场。
- 纯文本输出，不要 markdown 代码块包裹，不要标题符号「#」。

只输出重写后的需求正文本身。`;

/* -------------------------------------------------------------- 模型调用 */

/** 取当前默认模型选择；拿不到就返回空对象。 */
function pickSelection(ctx) {
  try {
    const service = ctx.get("agentDefaultModel");
    const selection = service?.currentSelection?.();
    if (selection && typeof selection.provider === "string" && typeof selection.model === "string") {
      return { provider: selection.provider, model: selection.model };
    }
  } catch {
    /* 没有这个服务就省略，交给 llm.stream 自己回退 */
  }
  return {};
}

/** 一次完整的流式生成，返回累加后的纯文本。 */
async function generate(ctx, system, user, maxTokens) {
  const llm = ctx.get("llm");
  if (llm === void 0 || typeof llm.stream !== "function") {
    throw new Error("llm 服务不可用");
  }

  const request = {
    system,
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    temperature: 0.3,
    maxTokens,
  };
  const selection = pickSelection(ctx);
  if (selection.provider !== void 0) {
    request.provider = selection.provider;
    request.model = selection.model;
  }

  let text = "";
  for await (const chunk of llm.stream(request)) {
    if (chunk === null || typeof chunk !== "object") continue;
    if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
    else if (chunk.type === "finish") break;
  }
  return text;
}

/* ----------------------------------------------------------------- 解析 */

/**
 * 从模型输出里抠出 JSON。模型经常外面裹一层 ```json 或者前后加一句话，
 * 所以先剥代码围栏，再退化为「第一个 { 到最后一个 }」。
 */
function parseJsonLoose(raw) {
  if (typeof raw !== "string") return undefined;
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    /* 继续退 */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 把 questions 数组洗成界面能直接渲染的形状。
 *
 * 除了常规清洗，这里还**兜底补上「我不知道，你替我定」**：模型偶尔会忘掉这条
 * 指令，而它是整个插件「零打字」承诺的地基——没有它，用户答不上来时只能打字。
 * 所以由代码保证，而不是指望提示词。
 */
function normalizeQuestions(value) {
  const list = Array.isArray(value?.questions) ? value.questions : [];
  const questions = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const question = typeof entry.question === "string" ? entry.question.trim() : "";
    if (question === "") continue;
    const options = (Array.isArray(entry.options) ? entry.options : [])
      .map((option) => (typeof option === "string" ? option.trim() : ""))
      .filter((option) => option !== "")
      .slice(0, 4);
    if (!options.includes(NO_IDEA)) options.push(NO_IDEA);
    questions.push({
      id: typeof entry.id === "string" && entry.id !== "" ? entry.id : `q${questions.length + 1}`,
      question: question.slice(0, 60),
      hint: typeof entry.hint === "string" ? entry.hint.trim().slice(0, 80) : "",
      options,
    });
    if (questions.length >= 3) break;
  }
  return {
    guess: typeof value?.guess === "string" ? value.guess.trim().slice(0, 200) : "",
    questions,
  };
}

/** 去掉模型爱加的 ``` 围栏和开场客套。 */
function cleanRewrite(raw) {
  let text = typeof raw === "string" ? raw.trim() : "";
  const fenced = text.match(/```(?:[a-z]+)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  return text.trim();
}

/* ------------------------------------------------------------ 请求处理 */

function isLoopback(req) {
  const address = req.socket?.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try {
    hostUrl = new URL("http://" + host);
  } catch {
    return false;
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostUrl.hostname)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function guard(req, res) {
  if (!isLoopback(req)) {
    writeJson(res, 403, { ok: false, error: "loopback requests only" });
    return false;
  }
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: `method not allowed: ${req.method ?? ""}` });
    return false;
  }
  return true;
}

/** 把用户原话格式化进提示词。 */
function frameDraft(draft) {
  const trimmed = draft.trim().slice(0, MAX_DRAFT);
  return `用户的原话：\n"""\n${trimmed}\n"""`;
}

export function apply(ctx) {
  ctx.inject(["webServer"], (sctx) => {
    sctx.effect(() => {
      const disposers = [
        // 诊断：确认模型服务与选中的 provider/model
        sctx.webServer.register({
          kind: "exact",
          path: `${API_PREFIX}/health`,
          handler: async (req, res) => {
            if (!guard(req, res)) return;
            const llm = sctx.get("llm");
            writeJson(res, 200, {
              ok: true,
              value: {
                llm: llm !== void 0 && typeof llm.stream === "function",
                ...pickSelection(sctx),
              },
            });
          },
        }),

        // 第一步：读懂原话，问出 2-3 个关键问题
        sctx.webServer.register({
          kind: "exact",
          path: `${API_PREFIX}/ask`,
          handler: async (req, res) => {
            if (!guard(req, res)) return;
            const body = await readJsonBody(req);
            if (body === void 0) {
              writeJson(res, 400, { ok: false, error: "请求体不是合法 JSON 或过大" });
              return;
            }
            const draft = typeof body.draft === "string" ? body.draft : "";
            if (draft.trim() === "") {
              writeJson(res, 400, { ok: false, code: "empty-draft", error: "输入框是空的，先随便写点想做的事" });
              return;
            }

            try {
              const raw = await generate(sctx, ASK_SYSTEM, frameDraft(draft), 900);
              const parsed = parseJsonLoose(raw);
              const value = normalizeQuestions(parsed);
              if (value.questions.length === 0) {
                // 模型没按格式来：把它的原话当作一句「我理解你想要的是……」交回去，
                // 界面会退化成「仅重写」流程，而不是报错。
                value.guess = value.guess !== "" ? value.guess : cleanRewrite(raw).slice(0, 200);
              }
              writeJson(res, 200, { ok: true, value });
            } catch (error) {
              writeJson(res, 500, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),

        // 第二步：按用户的选择重写成一条能直接发的需求
        sctx.webServer.register({
          kind: "exact",
          path: `${API_PREFIX}/rewrite`,
          handler: async (req, res) => {
            if (!guard(req, res)) return;
            const body = await readJsonBody(req);
            if (body === void 0) {
              writeJson(res, 400, { ok: false, error: "请求体不是合法 JSON 或过大" });
              return;
            }
            const draft = typeof body.draft === "string" ? body.draft : "";
            if (draft.trim() === "") {
              writeJson(res, 400, { ok: false, code: "empty-draft", error: "输入框是空的" });
              return;
            }

            // 把「问题 → 用户答案」拼成约束清单
            const answers = Array.isArray(body.answers) ? body.answers : [];
            const lines = [];
            for (const entry of answers) {
              if (entry === null || typeof entry !== "object") continue;
              const question = typeof entry.question === "string" ? entry.question.trim() : "";
              const answer = typeof entry.answer === "string" ? entry.answer.trim() : "";
              if (answer === "") continue; // 用户跳过的就不写进去
              lines.push(`- 问：${question || "补充信息"}　答：${answer}`);
            }
            const constraints =
              lines.length === 0 ? "用户没有补充额外信息，请只优化表达，不要臆造细节。" : lines.join("\n");
            const user = `${frameDraft(draft)}\n\n用户对追问的回答：\n${constraints}`;

            try {
              const raw = await generate(sctx, REWRITE_SYSTEM, user, 1600);
              const text = cleanRewrite(raw);
              if (text === "") {
                writeJson(res, 500, { ok: false, error: "模型返回了空内容，再试一次" });
                return;
              }
              writeJson(res, 200, { ok: true, value: { text } });
            } catch (error) {
              writeJson(res, 500, { ok: false, error: String(error?.message ?? error) });
            }
          },
        }),
      ];

      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            /* 卸载时单个失败不影响其它 */
          }
        }
      };
    }, "ask-first: web bridge");
  });
}
