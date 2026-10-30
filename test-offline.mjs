/**
 * 离线自检：不启动 DSH，直接把 Host 半边装进一个假 ctx 里跑通三条路由。
 *
 * 目的：在重启 DSH 之前先确认
 *   ① 模块能被 import（语法、导出名）
 *   ② apply() 注册出三条预期路径
 *   ③ ask/rewrite 的请求校验、JSON 抠取、噪声清理、错误回传都工作
 *   ④ llm 缺失时返回可读错误而不是崩掉
 *
 * 跑法：node C:/Users/15303/.dsh/plugins/dsh-ask-first/test-offline.mjs
 */

import { apply, name } from "./lib/index.js";

const routes = new Map();

/** 假的服务表：only 里有 key 才返回服务，模拟 llm 缺失/存在两种情况。 */
function makeCtx(services) {
  const ctx = {
    get(key) {
      return services[key];
    },
    inject(_deps, fn) {
      fn(ctx);
    },
    effect(fn) {
      const dispose = fn();
      return dispose;
    },
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
  };
  return ctx;
}

/** 假 req：loopback、POST、带 JSON body；body 传字符串可测非法 JSON。 */
function makeReq(body, overrides = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const chunks = [Buffer.from(payload, "utf8")];
  return {
    method: "POST",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "127.0.0.1:52780", origin: "http://127.0.0.1:52780", ...overrides },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

/** 假 res：收集 status 与 JSON。 */
function makeRes() {
  const out = { status: 0, body: undefined };
  return {
    out,
    writeHead(status) {
      out.status = status;
    },
    end(text) {
      try {
        out.body = JSON.parse(text);
      } catch {
        out.body = text;
      }
    },
  };
}

async function call(path, body, headers) {
  const route = routes.get(path);
  if (!route) throw new Error(`路由没注册：${path}`);
  const res = makeRes();
  await route.handler(makeReq(body, headers), res);
  return res.out;
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail === undefined ? "" : `  →  ${detail}`}`);
  }
}

/* ------------------------------------------------------------------ 场景一 */
console.log("\n[1] 没有 llm 服务时，插件仍能装起来并给出可读错误");

apply(makeCtx({}));
check("模块导出了 name", name === "ask-first", String(name));
check("注册了 ask", routes.has("/api/dsh-ask-first/ask"));
check("注册了 rewrite", routes.has("/api/dsh-ask-first/rewrite"));
check("注册了 health", routes.has("/api/dsh-ask-first/health"));

{
  const out = await call("/api/dsh-ask-first/health", {});
  check("health 200", out.status === 200, JSON.stringify(out));
  check("health 报告 llm=false", out.body?.value?.llm === false, JSON.stringify(out.body));
}
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "帮我做个网页" });
  check("无 llm 时 ask 返回 500 而不是崩溃", out.status === 500, JSON.stringify(out));
  check("错误文案可读", /llm/.test(String(out.body?.error)), JSON.stringify(out.body));
}

/* ------------------------------------------------------------------ 场景二 */
console.log("\n[2] 有 llm 时：合法 JSON、围栏包裹、纯文本退化、空草稿、非法 JSON");

routes.clear();

/** 可编排的假模型：按顺序吐出预设文本。 */
function fakeLlm(reply) {
  return {
    stream() {
      return (async function* () {
        yield { type: "block-start", index: 0, blockType: "text" };
        // 故意切成多段，验证 text-delta 累加
        const mid = Math.floor(reply.length / 2);
        yield { type: "text-delta", index: 0, text: reply.slice(0, mid) };
        yield { type: "reasoning-delta", index: 0, text: "（这段不该被拼进结果）" };
        yield { type: "text-delta", index: 0, text: reply.slice(mid) };
        yield { type: "finish", reason: "stop" };
      })();
    },
  };
}

// 2a 标准 JSON
apply(
  makeCtx({
    llm: fakeLlm(
      JSON.stringify({
        guess: "我理解你想做一个介绍自己的静态页面",
        questions: [
          { id: "q1", question: "给谁看？", options: ["面试官", "客户", "朋友"] },
          { id: "q2", question: "要不要配图？", options: ["要", "不要"] },
        ],
      }),
    ),
    agentDefaultModel: { currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }) },
  }),
);
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "帮我做个自我介绍网页" });
  check("ask 200", out.status === 200, JSON.stringify(out));
  check("guess 解析出来", typeof out.body?.value?.guess === "string" && out.body.value.guess.length > 0, JSON.stringify(out.body));
  check("两个问题", out.body?.value?.questions?.length === 2, JSON.stringify(out.body));
  // 模型给了 3 个选项，代码再兜底补上「我不知道，你替我定」→ 4 个
  check(
    "选项自动补上逃生项",
    out.body?.value?.questions?.[0]?.options?.length === 4 &&
      out.body.value.questions[0].options[3] === "我不知道，你替我定",
    JSON.stringify(out.body?.value?.questions?.[0]),
  );
  check("reasoning-delta 没混进结果", !JSON.stringify(out.body).includes("不该被拼进结果"));
}
{
  const out = await call("/api/dsh-ask-first/health", {});
  check("health 带出 provider", out.body?.value?.provider === "deepseek-official", JSON.stringify(out.body));
}
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "   " });
  check("空草稿 400", out.status === 400, JSON.stringify(out));
  check("空草稿有中文提示", /输入框/.test(String(out.body?.error)), JSON.stringify(out.body));
}
{
  const out = await call("/api/dsh-ask-first/ask", "{ 这不是 json");
  check("非法 body 400", out.status === 400, JSON.stringify(out));
}
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "做个网页" }, { origin: "http://evil.example.com" });
  check("跨站 origin 被拒 403", out.status === 403, JSON.stringify(out));
}

/* 2b 围栏包裹 + 脏问题 */
routes.clear();
apply(
  makeCtx({
    llm: fakeLlm(
      '```json\n{"guess":"做个落地页","questions":[{"question":"卖什么？","options":["软件","课程","","  服务  "]},{"id":"q2","question":"","options":["x"]}]}\n```',
    ),
  }),
);
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "帮我搞个落地页" });
  check("围栏 JSON 能解析", out.status === 200 && out.body?.value?.questions?.length === 1, JSON.stringify(out));
  // 原始选项是 ["软件","课程","","  服务  "]：空串被丢、两端空格被 trim，剩 3 个，
  // 再兜底补上逃生选项 → 4 个，「服务」仍在第 3 位（逃生项固定排最后）。
  check(
    "空选项被洗掉、空格被 trim",
    out.body?.value?.questions?.[0]?.options?.length === 4 &&
      out.body.value.questions[0].options[2] === "服务" &&
      out.body.value.questions[0].options[3] === "我不知道，你替我定",
    JSON.stringify(out.body?.value?.questions?.[0]),
  );
  check("空问题被丢掉", out.body?.value?.questions?.length === 1, JSON.stringify(out.body));
  check("缺 id 时补 q1", out.body?.value?.questions?.[0]?.id === "q1", JSON.stringify(out.body?.value?.questions?.[0]));
}

/* 2c 模型不按格式来（纯文本）→ 退化成 guess，不报错 */
routes.clear();
apply(makeCtx({ llm: fakeLlm("你想让我帮忙做一个介绍页面，但没说给谁看。") }));
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "帮我做页面" });
  check("非 JSON 输出不报错", out.status === 200, JSON.stringify(out));
  check("退化成 guess", String(out.body?.value?.guess).includes("介绍页面"), JSON.stringify(out.body));
  check("questions 为空数组", Array.isArray(out.body?.value?.questions) && out.body.value.questions.length === 0);
}

/* 2d rewrite：围栏清理 + 答案拼装 */
routes.clear();
let seenUser = "";
apply({
  get: () => ({
    stream(req) {
      seenUser = req.messages[0].content[0].text;
      return (async function* () {
        yield { type: "text-delta", index: 0, text: "```\n目标：做一个个人介绍页。\n" };
        yield { type: "text-delta", index: 0, text: "- 给面试官看\n- [待补充：要不要配图]\n```" };
        yield { type: "finish", reason: "stop" };
      })();
    },
  }),
  inject: (_d, fn) => fn(getCtxProxy()),
  effect: (fn) => fn(),
  webServer: { register: (r) => (routes.set(r.path, r), () => routes.delete(r.path)) },
});
function getCtxProxy() {
  return {
    get: () => ({
      stream(req) {
        seenUser = req.messages[0].content[0].text;
        return (async function* () {
          yield { type: "text-delta", index: 0, text: "```\n目标：做一个个人介绍页。\n- 给面试官看\n```" };
          yield { type: "finish", reason: "stop" };
        })();
      },
    }),
    inject: (_d, fn) => fn(getCtxProxy()),
    effect: (fn) => fn(),
    webServer: { register: (r) => (routes.set(r.path, r), () => routes.delete(r.path)) },
  };
}
{
  const out = await call("/api/dsh-ask-first/rewrite", {
    draft: "帮我做个自我介绍网页",
    answers: [
      { question: "给谁看？", answer: "面试官" },
      { question: "要不要配图？", answer: "" },
    ],
  });
  check("rewrite 200", out.status === 200, JSON.stringify(out));
  check("围栏被剥掉", !String(out.body?.value?.text).includes("```"), JSON.stringify(out.body));
  check("正文保留", String(out.body?.value?.text).includes("个人介绍页"), JSON.stringify(out.body));
  check("空答案没混进提示词", !seenUser.includes("要不要配图"), seenUser);
  check("有效答案进了提示词", seenUser.includes("面试官"), seenUser);
}
{
  const out = await call("/api/dsh-ask-first/rewrite", { draft: "做个网页", answers: [] });
  check("无答案时仍可重写", out.status === 200, JSON.stringify(out));
}

/* ------------------------------------------------------------------ 场景三 */
console.log("\n[3] 零打字承诺：每个问题都必须带「我不知道，你替我定」");

// 模型完全没给 options 的问题，也要被补上一个能点的大白话选项
routes.clear();
apply(
  makeCtx({
    llm: fakeLlm(
      JSON.stringify({
        guess: "做个小工具页面",
        questions: [{ id: "q1", question: "给谁用？" }, { id: "q2", question: "要不要登录？", options: [] }],
      }),
    ),
  }),
);
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "做个小工具页" });
  const list = out.body?.value?.questions || [];
  check("两个问题都在", list.length === 2, JSON.stringify(list));
  check(
    "没给选项的问题也补上了逃生项",
    list[0]?.options?.length === 1 && list[0].options[0] === "我不知道，你替我定",
    JSON.stringify(list[0]),
  );
  check(
    "空选项数组的问题也补上了逃生项",
    list[1]?.options?.length === 1 && list[1].options[0] === "我不知道，你替我定",
    JSON.stringify(list[1]),
  );
}

// 模型已经自己写了逃生项 → 不能重复追加
routes.clear();
apply(
  makeCtx({
    llm: fakeLlm(
      JSON.stringify({
        guess: "写个周报",
        questions: [{ id: "q1", question: "给谁看？", options: ["老板", "同事", "我不知道，你替我定"] }],
      }),
    ),
  }),
);
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "帮我写周报" });
  const options = out.body?.value?.questions?.[0]?.options || [];
  check("逃生项不重复追加", options.length === 3, JSON.stringify(options));
  check(
    "逃生项只出现一次",
    options.filter((one) => one === "我不知道，你替我定").length === 1,
    JSON.stringify(options),
  );
}

// 模型给满 5 个选项 → 截到 4 个再补逃生项，保证总长仍是 5
routes.clear();
apply(
  makeCtx({
    llm: fakeLlm(
      JSON.stringify({
        guess: "做张海报",
        questions: [{ id: "q1", question: "什么用途？", options: ["促销", "招聘", "公告", "活动", "其他"] }],
      }),
    ),
  }),
);
{
  const out = await call("/api/dsh-ask-first/ask", { draft: "做张海报" });
  const options = out.body?.value?.questions?.[0]?.options || [];
  check("选项最多 5 个", options.length === 5, JSON.stringify(options));
  check("挤掉的是第 5 个模型选项", !options.includes("其他"), JSON.stringify(options));
  check("逃生项排最后", options[4] === "我不知道，你替我定", JSON.stringify(options));
}

/* ------------------------------------------------------------------ 汇总 */
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
