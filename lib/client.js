window.__ModuleLoader__.load({
  id: "dsh-ask-first",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    // react-dom 只用来把面板 portal 到 body。万一这个 external 在某些宿主形态里
    // 拿不到，不该让整个插件加载失败——退化成原地渲染，功能照旧。
    var ReactDOM = null;
    try {
      ReactDOM = require("react-dom");
    } catch {
      ReactDOM = null;
    }

    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useMemo = React.useMemo;

    var API_PREFIX = "/api/dsh-ask-first";
    var SLOT = "conversation.input.left";
    var ENTRY_ID = "dsh-ask-first-entry";
    var LABEL = "说清楚点";
    // 与 lib/index.js 里的 NO_IDEA 必须一致：host 会用代码兜底补上这个选项，
    // 客户端靠这段字面量把它弱化显示。改一处就要改两处。
    var NO_IDEA = "我不知道，你替我定";

    /* ------------------------------------------------------------- 样式 */

    var css = [
      ".dshaf-btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 9px;border-radius:8px;",
      "border:1px solid var(--sys-color-neutral-outline,rgba(0,0,0,.14));",
      "background:transparent;color:var(--sys-color-on-surface-subtle,#6e6e73);",
      "font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;",
      "transition:background 150ms ease,color 150ms ease,border-color 150ms ease;flex:none}",
      ".dshaf-btn:hover{background:var(--sys-color-state-hover-on-subtle,rgba(0,0,0,.05));",
      "color:var(--sys-color-on-surface,#1d1d1f);border-color:var(--sys-color-neutral-outline,rgba(0,0,0,.24))}",
      ".dshaf-btn:disabled{opacity:.45;cursor:default}",
      ".dshaf-btn svg{flex:none;display:block}",
      ".dshaf-btnBusy svg{animation:dshaf-spin 900ms linear infinite}",
      "@keyframes dshaf-spin{to{transform:rotate(360deg)}}",

      ".dshaf-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.28);",
      "display:flex;align-items:flex-end;justify-content:center;padding:0 16px 12vh;",
      "animation:dshaf-fade 140ms ease}",
      "@keyframes dshaf-fade{from{opacity:0}to{opacity:1}}",

      ".dshaf-panel{width:100%;max-width:600px;max-height:74vh;display:flex;flex-direction:column;",
      "background:var(--sys-color-cdt-base-container,#fff);color:var(--sys-color-on-surface,#1d1d1f);",
      "border:1px solid var(--sys-color-divider,rgba(0,0,0,.1));",
      "border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.22);overflow:hidden;",
      "font-family:var(--dsh-font-family-text,-apple-system,\"SF Pro Text\",\"PingFang SC\",\"Segoe UI\",system-ui,sans-serif);",
      "font-size:13px;animation:dshaf-rise 160ms cubic-bezier(.2,.8,.3,1)}",
      "@keyframes dshaf-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}",

      ".dshaf-head{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;flex:none}",
      ".dshaf-title{font-size:14px;font-weight:600;flex:1;min-width:0}",
      ".dshaf-sub{font-size:12px;color:var(--sys-color-on-surface-subtle,#6e6e73);font-weight:400}",
      ".dshaf-x{flex:none;width:26px;height:26px;border-radius:7px;border:0;background:transparent;cursor:pointer;",
      "color:var(--sys-color-on-surface-subtle,#6e6e73);font-size:16px;line-height:1;display:flex;",
      "align-items:center;justify-content:center}",
      ".dshaf-x:hover{background:var(--sys-color-state-hover-on-subtle,rgba(0,0,0,.06));color:var(--sys-color-on-surface,#1d1d1f)}",

      ".dshaf-body{padding:2px 16px 12px;overflow-y:auto;flex:1;min-height:0}",
      ".dshaf-guess{padding:10px 12px 11px;border-radius:10px;background:var(--sys-color-tonal-container,rgba(0,113,227,.08));",
      "color:var(--sys-color-on-tonal-container,#0b4f9e);font-size:12.5px;line-height:1.5;margin-bottom:14px}",
      ".dshaf-guessTag{font-size:11px;font-weight:600;letter-spacing:.02em;opacity:.72;margin-bottom:3px}",
      ".dshaf-guessText{font-size:13.5px;font-weight:500;line-height:1.55}",
      ".dshaf-guessAsk{margin-top:7px;padding-top:7px;font-size:11.5px;opacity:.72;",
      "border-top:1px solid var(--sys-color-tonal-outline,rgba(11,79,158,.16))}",

      ".dshaf-q{margin-bottom:16px}",
      ".dshaf-qlabel{display:flex;align-items:baseline;gap:6px;margin-bottom:7px;font-size:12.5px;font-weight:600;line-height:1.4}",
      ".dshaf-qnum{flex:none;width:17px;height:17px;border-radius:5px;background:var(--sys-color-neutral-container,rgba(0,0,0,.07));",
      "color:var(--sys-color-on-surface-subtle,#6e6e73);font-size:11px;font-weight:600;display:flex;",
      "align-items:center;justify-content:center;line-height:1}",
      ".dshaf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:7px}",
      ".dshaf-chip{padding:5px 10px;border-radius:999px;cursor:pointer;font:inherit;font-size:12px;line-height:1.2;",
      "border:1px solid var(--sys-color-neutral-outline,rgba(0,0,0,.14));background:transparent;",
      "color:var(--sys-color-on-surface,#1d1d1f);transition:all 130ms ease;white-space:nowrap}",
      ".dshaf-chip:hover{border-color:var(--sys-color-primary,#0071e3);color:var(--sys-color-primary,#0071e3)}",
      ".dshaf-chipOn{background:var(--sys-color-primary,#0071e3);border-color:var(--sys-color-primary,#0071e3);",
      "color:var(--sys-color-on-primary,#fff);font-weight:500}",
      ".dshaf-chipOn:hover{color:var(--sys-color-on-primary,#fff);opacity:.9}",
      ".dshaf-chipSoft{border-style:dashed;color:var(--sys-color-on-surface-subtle,#6e6e73)}",

      ".dshaf-input,.dshaf-textarea{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:9px;",
      "border:1px solid var(--sys-color-neutral-outline,rgba(0,0,0,.14));",
      "background:var(--dsw-alias-bg-base,transparent);color:inherit;font:inherit;font-size:12.5px;line-height:1.5;",
      "outline:none;transition:border-color 130ms ease,box-shadow 130ms ease;resize:none}",
      ".dshaf-input:focus,.dshaf-textarea:focus{border-color:var(--dsw-focus-ring-color,var(--sys-color-primary,#0071e3));",
      "box-shadow:0 0 0 3px rgba(0,113,227,.12)}",
      ".dshaf-input::placeholder,.dshaf-textarea::placeholder{color:var(--sys-color-on-surface-subtle,#8e8e93)}",

      ".dshaf-result{display:flex;flex-direction:column;gap:10px}",
      ".dshaf-textarea{min-height:180px;max-height:42vh;font-family:inherit}",
      ".dshaf-count{font-size:11px;color:var(--sys-color-on-surface-subtle,#8e8e93);text-align:right;flex:none}",

      ".dshaf-foot{display:flex;align-items:center;gap:8px;padding:11px 16px;flex:none;",
      "border-top:1px solid var(--sys-color-divider,rgba(0,0,0,.08));background:transparent;flex-wrap:wrap}",
      ".dshaf-grow{flex:1;min-width:0}",
      ".dshaf-act{height:31px;padding:0 14px;border-radius:9px;border:1px solid transparent;cursor:pointer;",
      "font:inherit;font-size:12.5px;font-weight:500;line-height:1;white-space:nowrap;transition:all 130ms ease}",
      ".dshaf-actPrimary{background:var(--sys-color-primary,#0071e3);color:var(--sys-color-on-primary,#fff)}",
      ".dshaf-actPrimary:hover{opacity:.88}",
      ".dshaf-actGhost{background:transparent;color:var(--sys-color-on-surface-subtle,#6e6e73);",
      "border-color:var(--sys-color-neutral-outline,rgba(0,0,0,.14))}",
      ".dshaf-actGhost:hover{background:var(--sys-color-state-hover-on-subtle,rgba(0,0,0,.05));",
      "color:var(--sys-color-on-surface,#1d1d1f)}",
      ".dshaf-act:disabled{opacity:.45;cursor:default}",

      ".dshaf-note{font-size:12px;color:var(--sys-color-on-surface-subtle,#6e6e73);line-height:1.5}",
      ".dshaf-err{padding:10px 12px;border-radius:10px;background:rgba(255,59,48,.09);",
      "color:var(--sys-color-error,#c8231b);font-size:12.5px;line-height:1.5;word-break:break-word}",

      ".dshaf-loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:26px 0 22px}",
      ".dshaf-dots{display:flex;gap:5px}",
      ".dshaf-dots i{width:7px;height:7px;border-radius:50%;background:var(--sys-color-primary,#0071e3);",
      "animation:dshaf-bounce 1.2s infinite ease-in-out}",
      ".dshaf-dots i:nth-child(2){animation-delay:.16s}",
      ".dshaf-dots i:nth-child(3){animation-delay:.32s}",
      "@keyframes dshaf-bounce{0%,70%,100%{opacity:.28;transform:translateY(0)}35%{opacity:1;transform:translateY(-5px)}}",
      ".dshaf-loadText{font-size:12.5px;color:var(--sys-color-on-surface-subtle,#6e6e73)}",
    ].join("");

    var TAG_ID = "dsh-ask-first/panel.css";

    /**
     * 挂样式。按宿主约定，资源要在 apply 里经 ctx.effect 注册并带清理函数，
     * 这样插件卸载/热替换时不会在 <head> 里留下无人认领的 <style>。
     * 先查重：同一份样式重复挂只会让层叠变复杂，不会有任何好处。
     * @returns {() => void} 移除自己挂上去的那个标签
     */
    function mountStyles() {
      if (typeof document === "undefined" || document.head === null) return function () {};
      var selector = "style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]";
      var existing = document.querySelector(selector);
      if (existing !== null) return function () {};
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-ask-first";
      tag.dataset.pluginCss = TAG_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
      return function () {
        if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
      };
    }

    /* --------------------------------------------------------- 桥接调用 */

    async function post(path, body) {
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 120000) : null;
      try {
        var response = await fetch(API_PREFIX + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined,
        });
        var data = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (data === null) throw new Error("宿主返回了非 JSON 内容（HTTP " + response.status + "）");
        return data;
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    /** 把 bridge 的返回揉成一句能给人看的话。 */
    function describeError(data, fallback) {
      if (data && typeof data.error === "string" && data.error !== "") return data.error;
      return fallback;
    }

    /* --------------------------------------------------------- 小部件 */

    function IconPencil() {
      return h(
        "svg",
        { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M11.5 1.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-7.8 7.8-3.4.9.9-3.4 7.3-7.3Z",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinejoin: "round",
        }),
      );
    }

    function IconSpark() {
      return h(
        "svg",
        { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M8 1.8v3M8 11.2v3M1.8 8h3M11.2 8h3M3.6 3.6l2 2M10.4 10.4l2 2M12.4 3.6l-2 2M5.6 10.4l-2 2",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
        }),
      );
    }

    function Spinner() {
      return h(
        "svg",
        { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("circle", { cx: 8, cy: 8, r: 6, stroke: "currentColor", strokeWidth: 1.6, opacity: 0.25 }),
        h("path", {
          d: "M8 2a6 6 0 0 1 6 6",
          stroke: "currentColor",
          strokeWidth: 1.6,
          strokeLinecap: "round",
        }),
      );
    }

    /* ----------------------------------------------------------- 面板 */

    /**
     * 阶段：
     *   asking    —— 等模型读懂原话、给出追问
     *   questions —— 显示追问，等用户选/填
     *   writing   —— 等模型重写
     *   result    —— 显示重写结果，等用户填回
     */
    function Panel(props) {
      var draft = props.draft;
      var onClose = props.onClose;
      var onApply = props.onApply;

      var stageState = useState("asking");
      var stage = stageState[0];
      var setStage = stageState[1];

      var payloadState = useState(null); // { guess, questions }
      var payload = payloadState[0];
      var setPayload = payloadState[1];

      var answerState = useState({}); // { [questionId]: string }
      var answers = answerState[0];
      var setAnswers = answerState[1];

      var resultState = useState("");
      var result = resultState[0];
      var setResult = resultState[1];

      var errorState = useState("");
      var error = errorState[0];
      var setError = errorState[1];

      var aliveRef = useRef(true);
      var askedRef = useRef(false);

      useEffect(function () {
        aliveRef.current = true;
        return function () {
          aliveRef.current = false;
        };
      }, []);

      // 打开就发第一问。只发一次（StrictMode 双调用也挡住）。
      useEffect(function () {
        if (askedRef.current) return;
        askedRef.current = true;
        (async function () {
          var data;
          try {
            data = await post("/ask", { draft: draft });
          } catch (failure) {
            if (!aliveRef.current) return;
            setError("连不上本机的改写服务：" + String(failure && failure.message ? failure.message : failure));
            setStage("questions");
            return;
          }
          if (!aliveRef.current) return;
          if (!data || data.ok !== true) {
            setError(describeError(data, "模型没有给出追问"));
            setStage("questions");
            return;
          }
          var value = data.value || {};
          setPayload({ guess: value.guess || "", questions: Array.isArray(value.questions) ? value.questions : [] });
          setStage("questions");
        })();
      }, []);

      // Esc 关闭
      useEffect(function () {
        function onKey(event) {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }
        document.addEventListener("keydown", onKey, true);
        return function () {
          document.removeEventListener("keydown", onKey, true);
        };
      }, [onClose]);

      function setAnswer(id, value) {
        setAnswers(function (previous) {
          var next = {};
          for (var key in previous) if (Object.prototype.hasOwnProperty.call(previous, key)) next[key] = previous[key];
          next[id] = value;
          return next;
        });
      }

      async function doRewrite() {
        setError("");
        setStage("writing");
        var collected = [];
        var questions = (payload && payload.questions) || [];
        for (var index = 0; index < questions.length; index += 1) {
          var question = questions[index];
          var answer = answers[question.id];
          if (typeof answer === "string" && answer.trim() !== "") {
            collected.push({ question: question.question, answer: answer.trim() });
          }
        }
        var data;
        try {
          data = await post("/rewrite", { draft: draft, answers: collected });
        } catch (failure) {
          if (!aliveRef.current) return;
          setError("重写请求失败：" + String(failure && failure.message ? failure.message : failure));
          setStage("questions");
          return;
        }
        if (!aliveRef.current) return;
        if (!data || data.ok !== true) {
          setError(describeError(data, "模型没有给出结果"));
          setStage("questions");
          return;
        }
        setResult((data.value && data.value.text) || "");
        setStage("result");
      }

      function restart() {
        askedRef.current = false;
        setPayload(null);
        setAnswers({});
        setResult("");
        setError("");
        setStage("asking");
        // 复用手上已有的草稿重问一遍
        (async function () {
          var data;
          try {
            data = await post("/ask", { draft: draft });
          } catch (failure) {
            if (!aliveRef.current) return;
            setError(String(failure && failure.message ? failure.message : failure));
            setStage("questions");
            return;
          }
          if (!aliveRef.current) return;
          if (!data || data.ok !== true) {
            setError(describeError(data, "模型没有给出追问"));
            setStage("questions");
            return;
          }
          var value = data.value || {};
          setPayload({ guess: value.guess || "", questions: Array.isArray(value.questions) ? value.questions : [] });
          setStage("questions");
        })();
      }

      var questions = (payload && payload.questions) || [];
      var body;

      if (stage === "asking") {
        body = h(
          "div",
          { className: "dshaf-loading" },
          h("div", { className: "dshaf-dots" }, h("i", null), h("i", null), h("i", null)),
          h("div", { className: "dshaf-loadText" }, "正在读你这句话，想想还缺什么……"),
        );
      } else if (stage === "writing") {
        body = h(
          "div",
          { className: "dshaf-loading" },
          h("div", { className: "dshaf-dots" }, h("i", null), h("i", null), h("i", null)),
          h("div", { className: "dshaf-loadText" }, "正在按你的选择重写……"),
        );
      } else if (stage === "result") {
        body = h(
          "div",
          { className: "dshaf-result" },
          h("div", { className: "dshaf-note" }, "觉得可以就直接填回输入框；还能再改。"),
          h("textarea", {
            className: "dshaf-textarea",
            value: result,
            spellCheck: false,
            onChange: function (event) {
              setResult(event.target.value);
            },
          }),
          h("div", { className: "dshaf-count" }, result.length + " 字"),
        );
      } else {
        body = h(
          "div",
          null,
          error !== "" ? h("div", { className: "dshaf-err" }, error) : null,
          // 「我理解你想要的是……」单独成块：它是用户判断 AI 有没有听懂的唯一依据，
          // 混在问题堆里就没人看了。旁边再问一句「理解对了吗」，把用户引到选择上。
          payload && payload.guess
            ? h(
                "div",
                { className: "dshaf-guess" },
                h("div", { className: "dshaf-guessTag" }, "我理解你想要的是"),
                h("div", { className: "dshaf-guessText" }, payload.guess),
                h(
                  "div",
                  { className: "dshaf-guessAsk" },
                  questions.length > 0
                    ? "理解对了吗？下面几问点一下就行，不用打字。"
                    : "理解对了吗？直接重写就行。",
                ),
              )
            : null,
          questions.length === 0
            ? h(
                "div",
                { className: "dshaf-note" },
                error !== "" ? "可以直接重写，也可以关掉自己再改。" : "这句话挺清楚了，直接重写就行。",
              )
            : questions.map(function (question, index) {
                var current = answers[question.id] || "";
                return h(
                  "div",
                  { className: "dshaf-q", key: question.id },
                  h(
                    "div",
                    { className: "dshaf-qlabel" },
                    h("span", { className: "dshaf-qnum" }, String(index + 1)),
                    h("span", null, question.question),
                  ),
                  question.options && question.options.length > 0
                    ? h(
                        "div",
                        { className: "dshaf-chips" },
                        question.options.map(function (option) {
                          var on = current === option;
                          // 逃生选项弱化一层：选它等于「你替我定」，不该跟正经答案抢眼。
                          var soft = option === NO_IDEA;
                          return h(
                            "button",
                            {
                              type: "button",
                              key: option,
                              className:
                                "dshaf-chip" + (on ? " dshaf-chipOn" : "") + (soft && !on ? " dshaf-chipSoft" : ""),
                              onClick: function () {
                                setAnswer(question.id, on ? "" : option);
                              },
                            },
                            option,
                          );
                        }),
                      )
                    : null,
                  h("input", {
                    className: "dshaf-input",
                    value: current,
                    placeholder:
                      question.options && question.options.length > 0 ? "或者自己写一个答法（可留空）" : "写下你的答案（可留空）",
                    onChange: function (event) {
                      setAnswer(question.id, event.target.value);
                    },
                  }),
                );
              }),
          questions.length > 0
            ? h("div", { className: "dshaf-note" }, "不想答的留空就行；一个都不选也能直接重写。")
            : null,
        );
      }

      var footer;
      if (stage === "result") {
        footer = h(
          "div",
          { className: "dshaf-foot" },
          h(
            "button",
            {
              type: "button",
              className: "dshaf-act dshaf-actPrimary",
              onClick: function () {
                if (result.trim() !== "") onApply(result);
              },
              disabled: result.trim() === "",
            },
            "填回输入框",
          ),
          h(
            "button",
            {
              type: "button",
              className: "dshaf-act dshaf-actGhost",
              onClick: restart,
            },
            "重新问一遍",
          ),
          h("div", { className: "dshaf-grow" }),
          h(
            "button",
            { type: "button", className: "dshaf-act dshaf-actGhost", onClick: onClose },
            "关掉",
          ),
        );
      } else if (stage === "asking" || stage === "writing") {
        footer = h(
          "div",
          { className: "dshaf-foot" },
          h("div", { className: "dshaf-grow" }),
          h("button", { type: "button", className: "dshaf-act dshaf-actGhost", onClick: onClose }, "取消"),
        );
      } else {
        footer = h(
          "div",
          { className: "dshaf-foot" },
          h(
            "button",
            { type: "button", className: "dshaf-act dshaf-actPrimary", onClick: doRewrite },
            questions.length > 0 ? "按这些重写" : "重写",
          ),
          h(
            "button",
            { type: "button", className: "dshaf-act dshaf-actGhost", onClick: onClose },
            "取消",
          ),
          h("div", { className: "dshaf-grow" }),
          h(
            "button",
            { type: "button", className: "dshaf-act dshaf-actGhost", onClick: onClose, title: "保留原来的说法" },
            "什么都不改",
          ),
        );
      }

      return h(
        "div",
        {
          className: "dshaf-backdrop",
          onMouseDown: function (event) {
            if (event.target === event.currentTarget) onClose();
          },
        },
        h(
          "div",
          { className: "dshaf-panel", role: "dialog", "aria-modal": "true" },
          h(
            "div",
            { className: "dshaf-head" },
            h("div", { className: "dshaf-title" }, LABEL),
            h("div", { className: "dshaf-sub" }, "先问清楚，再发送"),
            h("div", { style: { flex: 1 } }),
            h(
              "button",
              { type: "button", className: "dshaf-x", onClick: onClose, title: "关闭（Esc）" },
              "×",
            ),
          ),
          h("div", { className: "dshaf-body" }, body),
          footer,
        ),
      );
    }

    /* --------------------------------------------------- 输入框里的按钮 */

    /**
     * 两个壳子，一个渲染函数。
     *
     * `props.useInput` 是宿主传下来的快照选择器 hook，只能无条件调用；直接在外层
     * 写 `useInput ? useInput(...) : ""` 就会变成条件调用 hook，一旦这个 prop 在
     * 两次渲染之间出现或消失，React 的 hook 顺序就错位了。所以按「有没有 useInput」
     * 分成两个组件：每个组件内部的 hook 调用序列都是固定的，两者共用下面的渲染函数。
     */
    function AskFirstButtonLive(props) {
      var liveDraft = props.useInput(function (state) {
        return state && typeof state.draft === "string" ? state.draft : "";
      });
      return renderAskFirstButton(props, liveDraft);
    }

    function AskFirstButtonStatic(props) {
      return renderAskFirstButton(props, "");
    }

    function renderAskFirstButton(props, liveDraft) {
      var inputActions = props.inputActions;
      var openState = useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var draftState = useState("");
      var draft = draftState[0];
      var setDraft = draftState[1];
      var tipState = useState("");
      var tip = tipState[0];
      var setTip = tipState[1];

      // 优先用 useInput 拿到的实时草稿；拿不到就退到 inputActions.snapshot。
      function currentDraft() {
        if (typeof liveDraft === "string" && liveDraft !== "") return liveDraft;
        try {
          return inputActions && inputActions.snapshot && typeof inputActions.snapshot.draft === "string"
            ? inputActions.snapshot.draft
            : "";
        } catch {
          return "";
        }
      }

      function launch() {
        var text = currentDraft();
        if (text.trim() === "") {
          setTip("先随便写点想做的事，再点这里");
          window.setTimeout(function () {
            setTip("");
          }, 2200);
          return;
        }
        if (text.length > 8000) text = text.slice(0, 8000);
        setDraft(text);
        setOpen(true);
      }

      function apply(text) {
        try {
          if (inputActions && typeof inputActions.setDraft === "function") inputActions.setDraft(text);
        } catch (failure) {
          console.error("[dsh-ask-first] 回填失败", failure);
        }
        setOpen(false);
      }

      var button = h(
        "button",
        {
          type: "button",
          className: "dshaf-btn",
          onClick: launch,
          title: "不用会描述：点几下选项，我替你把需求问清楚",
        },
        h(IconPencil, null),
        LABEL,
      );

      var panel = null;
      if (open) {
        var node = h(Panel, { draft: draft, onClose: function () { setOpen(false); }, onApply: apply });
        panel =
          typeof document !== "undefined" && typeof ReactDOM.createPortal === "function"
            ? ReactDOM.createPortal(node, document.body)
            : node;
      }

      if (tip === "") return h(React.Fragment, null, button, panel);
      return h(
        React.Fragment,
        null,
        button,
        h(
          "span",
          {
            style: {
              fontSize: "11.5px",
              color: "var(--sys-color-on-surface-subtle,#8e8e93)",
              marginLeft: 6,
              whiteSpace: "nowrap",
            },
          },
          tip,
        ),
        panel,
      );
    }

    /** 入口：宿主给了 useInput 就走 Live 壳，没给就走 Static 壳。两者 hook 序列各自固定。 */
    function AskFirstButton(props) {
      return typeof props.useInput === "function"
        ? h(AskFirstButtonLive, props)
        : h(AskFirstButtonStatic, props);
    }

    /* ------------------------------------------------------------ 注册 */

    function apply(ctx) {
      // 样式与插槽注册都挂在 effect 里：插件被卸载时宿主能收回它们。
      ctx.effect(mountStyles, "dsh-ask-first: panel styles");
      ctx.slots.inject(SLOT, function () {
        return ctx.slots.register(
          { name: SLOT, id: ENTRY_ID, order: 20, label: LABEL },
          AskFirstButton,
        );
      });
    }

    var inject = ["slots"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
