/*
  Copyright (c) Microsoft Corporation.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import type { CallLog, ElementInfo, Mode, Source } from "./recorderTypes";
import { CodeMirrorWrapper } from "@web/components/codeMirrorWrapper";
import CodePreview from "@web/components/codePreview";
import type { SourceHighlight } from "@web/components/codeMirrorWrapper";
import { SplitView } from "@web/components/splitView";
import { TabbedPane } from "@web/components/tabbedPane";
import { Toolbar } from "@web/components/toolbar";
import { emptySource, SourceChooser } from "@web/components/sourceChooser";
import { ToolbarButton, ToolbarSeparator } from "@web/components/toolbarButton";
import * as React from "react";
import { CallLogView } from "./callLog";
import "./recorder.css";
import { asLocator } from "@isomorphic/locatorGenerators";
import { toggleTheme } from "@web/theme";
import { copy, useSetting } from "@web/uiUtils";
import yaml from "yaml";
import { parseAriaSnapshot } from "@isomorphic/ariaSnapshot";

export interface RecorderProps {
  sources: Source[];
  paused: boolean;
  log: Map<string, CallLog>;
  mode: Mode;
  onEditedCode?: (code: string) => any;
  onCursorActivity?: (position: { line: number }) => any;
}

export const Recorder: React.FC<RecorderProps> = ({
  sources,
  paused,
  log,
  mode,
  onEditedCode,
  onCursorActivity,
}) => {
  const [selectedFileId, setSelectedFileId] = React.useState<
    string | undefined
  >();
  const [runningFileId, setRunningFileId] = React.useState<
    string | undefined
  >();
  const [selectedTab, setSelectedTab] = useSetting<string>(
    "recorderPropertiesTab",
    "log"
  );
  const [copyOver, setCopyOver] = React.useState<boolean>(false);
  const [delList, setDelList] = React.useState<number[]>([]);
  const [ariaSnapshot, setAriaSnapshot] = React.useState<string | undefined>();
  const [ariaSnapshotErrors, setAriaSnapshotErrors] =
    React.useState<SourceHighlight[]>();
  const [selectorFocusOnChange, setSelectorFocusOnChange] = React.useState<
    boolean | undefined
  >(true);

  const fileId = selectedFileId || runningFileId || sources[0]?.id;

  const source = React.useMemo(() => {
    console.log(sources, fileId, "sources", "fileId");
    if (fileId) {
      const source = sources.find((s) => s.id === fileId);
      if (source) return source;
    }
    return emptySource();
  }, [sources, fileId]);

  const [locator, setLocator] = React.useState("");
  window.playwrightElementPicked = (
    elementInfo: ElementInfo,
    userGesture?: boolean
  ) => {
    const language = source.language;
    setLocator(asLocator(language, elementInfo.selector));
    setAriaSnapshot(elementInfo.ariaSnapshot);
    setAriaSnapshotErrors([]);
    setSelectorFocusOnChange(userGesture);

    if (userGesture && selectedTab !== "locator" && selectedTab !== "aria")
      setSelectedTab("locator");

    if (mode === "inspecting" && selectedTab === "aria") {
      // Keep exploring aria.
    } else {
      const isRecording = [
        "recording",
        "assertingText",
        "assertingVisibility",
        "assertingValue",
        "assertingSnapshot",
      ].includes(mode);
      window
        .dispatch({
          event: "setMode",
          params: { mode: isRecording ? "recording" : "standby" },
        })
        .catch(() => {});
    }
  };

  window.playwrightSetRunningFile = setRunningFileId;

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }, [messagesEndRef]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "F8":
          event.preventDefault();
          if (paused) window.dispatch({ event: "resume" });
          else window.dispatch({ event: "pause" });
          break;
        case "F10":
          event.preventDefault();
          if (paused) window.dispatch({ event: "step" });
          break;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [paused]);

  const onEditorChange = React.useCallback(
    (selector: string) => {
      if (mode === "none" || mode === "inspecting")
        window.dispatch({ event: "setMode", params: { mode: "standby" } });
      setLocator(selector);
      window.dispatch({ event: "highlightRequested", params: { selector } });
    },
    [mode]
  );

  const onAriaEditorChange = React.useCallback(
    (ariaSnapshot: string) => {
      if (mode === "none" || mode === "inspecting")
        window.dispatch({ event: "setMode", params: { mode: "standby" } });
      const { fragment, errors } = parseAriaSnapshot(yaml, ariaSnapshot, {
        prettyErrors: false,
      });
      const highlights = errors.map((error) => {
        const highlight: SourceHighlight = {
          message: error.message,
          line: error.range[1].line,
          column: error.range[1].col,
          type: "subtle-error",
        };
        return highlight;
      });
      setAriaSnapshotErrors(highlights);
      setAriaSnapshot(ariaSnapshot);
      if (!errors.length)
        window.dispatch({
          event: "highlightRequested",
          params: { ariaTemplate: fragment },
        });
    },
    [mode]
  );
  const getFillName = (v: any) => {
    switch (v?.name) {
      case "openPage":
        return `打开页面：${v?.url}`;
        break;
      case "navigate":
        return `页面跳转：${v?.url}`;
        break;
      case "closePage":
        return "关闭页面";
        break;
      case "click":
        return `${v?.button == "right" ? "右击" : ""}${
          v?.button == "middle" ? "中键" : ""
        }${v?.clickCount == 1 ? "点击" : ""}${
          v?.clickCount == 2 ? "双击" : ""
        }：${v?.locator?.options?.name || v?.locator?.body}`;
        break;
      case "press":
        return `按下按键：${v?.key}`;
        break;
      case "fill":
        return `输入：${v?.text}`;
        break;
      case "check":
        return `勾选：${v?.locator?.options?.name || v?.locator?.body}`;
        break;
      case "uncheck":
        return `取消勾选：${v?.locator?.options?.name || v?.locator?.body}`;
        break;
      case "setInputFiles":
        return `上传文件：${v?.locator?.options?.name || v?.locator?.body}`;
        break;
      case "assertText":
        return `断言：${
          v?.locator?.options?.name || v?.locator?.body
        }的文本内容是否为${v?.text}`;
        break;
      case "assertValue":
        return `断言：${
          v?.locator?.options?.name || v?.locator?.body
        }的值是否为${v?.text}`;
        break;
      case "assertVisible":
        return `断言：${v?.locator?.options?.name || v?.locator?.body}是否可见`;
        break;
      case "assertChecked":
        return `断言：${v?.locator?.options?.name || v?.locator?.body}${
          v?.checked ? "勾选" : "未勾选"
        }`;
        break;
      case "select":
        return `选中：${v?.options?.map((k: string) => k)}`;
        break;
      default:
        break;
    }
  };
  return (
    <div className="recorder">
      <Toolbar>
        <ToolbarButton
          icon="circle-large-filled"
          title="开始/暂停"
          toggled={
            mode === "recording" ||
            mode === "recording-inspecting" ||
            mode === "assertingText" ||
            mode === "assertingVisibility"
          }
          className="start-btn"
          onClick={() => {
            window.dispatch({
              event: "setMode",
              params: {
                mode:
                  mode === "none" || mode === "standby" || mode === "inspecting"
                    ? "recording"
                    : "standby",
              },
            });
          }}
        >
          {mode === "none" || mode === "standby" || mode === "inspecting"
            ? "开始"
            : "暂停"}
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton
          icon="inspect"
          title="抓取元素"
          toggled={mode === "inspecting" || mode === "recording-inspecting"}
          onClick={() => {
            const newMode = {
              inspecting: "standby",
              none: "inspecting",
              standby: "inspecting",
              recording: "recording-inspecting",
              "recording-inspecting": "recording",
              assertingText: "recording-inspecting",
              assertingVisibility: "recording-inspecting",
              assertingValue: "recording-inspecting",
              assertingSnapshot: "recording-inspecting",
            }[mode];
            window
              .dispatch({ event: "setMode", params: { mode: newMode } })
              .catch(() => {});
          }}
        ></ToolbarButton>
        <ToolbarButton
          icon="eye"
          title="断言元素可见性"
          toggled={mode === "assertingVisibility"}
          disabled={
            mode === "none" || mode === "standby" || mode === "inspecting"
          }
          onClick={() => {
            window.dispatch({
              event: "setMode",
              params: {
                mode:
                  mode === "assertingVisibility"
                    ? "recording"
                    : "assertingVisibility",
              },
            });
          }}
        ></ToolbarButton>
        <ToolbarButton
          icon="whole-word"
          title="断言文本"
          toggled={mode === "assertingText"}
          disabled={
            mode === "none" || mode === "standby" || mode === "inspecting"
          }
          onClick={() => {
            window.dispatch({
              event: "setMode",
              params: {
                mode: mode === "assertingText" ? "recording" : "assertingText",
              },
            });
          }}
        ></ToolbarButton>
        <ToolbarButton
          icon="symbol-constant"
          title="断言勾选状态/输入值"
          toggled={mode === "assertingValue"}
          disabled={
            mode === "none" || mode === "standby" || mode === "inspecting"
          }
          onClick={() => {
            window.dispatch({
              event: "setMode",
              params: {
                mode:
                  mode === "assertingValue" ? "recording" : "assertingValue",
              },
            });
          }}
        ></ToolbarButton>
        {/* <ToolbarButton
          icon="gist"
          title="Assert snapshot"
          toggled={mode === "assertingSnapshot"}
          disabled={
            mode === "none" || mode === "standby" || mode === "inspecting"
          }
          onClick={() => {
            window.dispatch({
              event: "setMode",
              params: {
                mode:
                  mode === "assertingSnapshot"
                    ? "recording"
                    : "assertingSnapshot",
              },
            });
          }}
        ></ToolbarButton> */}
        <ToolbarSeparator />
        {copyOver ? (
          <ToolbarButton
            icon="check"
            style={{ color: "#26cea4" }}
            onClick={() => {}}
            title=""
          ></ToolbarButton>
        ) : (
          <ToolbarButton
            icon="files"
            title="复制录制步骤"
            disabled={!source || !source.text}
            onClick={() => {
              const jsonl = sources[sources?.length - 1];
              const actions: any = jsonl?.actions?.filter(
                (v, index) => !delList?.some((k) => k == index)
              );
              let final = [...actions];
              try {
                final = actions?.map((v: any) =>
                  JSON.stringify({
                    ...JSON.parse(v),
                    fill_name: getFillName(JSON.parse(v)),
                  })
                );
              } catch (error) {}
              setCopyOver(true);
              copy(
                jsonl?.header +
                  "\n" +
                  (final || []).join("\n") +
                  "\n" +
                  jsonl?.footer
              );
              setTimeout(() => {
                setCopyOver(false);
              }, 1000);
            }}
          ></ToolbarButton>
        )}

        <ToolbarButton
          icon="debug-continue"
          title="执行步骤"
          ariaLabel="Resume"
          disabled={!paused}
          onClick={() => {
            window.dispatch({ event: "resume" });
          }}
        ></ToolbarButton>
        <ToolbarButton
          icon="debug-pause"
          title="暂停"
          ariaLabel="Pause"
          disabled={paused}
          onClick={() => {
            window.dispatch({ event: "pause" });
          }}
        ></ToolbarButton>
        <ToolbarButton
          icon="debug-step-over"
          title="执行下一步"
          ariaLabel="Step over"
          disabled={!paused}
          onClick={() => {
            window.dispatch({ event: "step" });
          }}
        ></ToolbarButton>
        <div style={{ flex: "auto" }}></div>
        {/* <div>Target:</div> */}
        {/* <SourceChooser
          fileId={fileId}
          sources={sources}
          setFileId={(fileId) => {
            console.log(fileId, "fileId");

            setSelectedFileId(fileId);
            window.dispatch({ event: "fileChanged", params: { file: fileId } });
          }}
        /> */}
        <ToolbarButton
          icon="clear-all"
          title="清除步骤"
          disabled={!source || !source.text}
          onClick={() => {
            setDelList([]);
            window.dispatch({ event: "clear" });
          }}
        ></ToolbarButton>
        <ToolbarButton
          icon="color-mode"
          title="切换主题色"
          toggled={false}
          onClick={() => toggleTheme()}
        ></ToolbarButton>
      </Toolbar>
      <SplitView
        sidebarSize={200}
        main={
          <div style={{ position: "relative", width: "100%" }}>
            <CodePreview
              sourceJsonl={sources[sources?.length - 1]}
              onChange={onEditedCode}
              source={source}
              delList={delList || []}
              setDelList={setDelList}
            />
            <CodeMirrorWrapper
              text={source.text}
              language={source.language}
              highlight={source.highlight}
              revealLine={source.revealLine}
              readOnly={source.id !== "jsonl"}
              onChange={onEditedCode}
              onCursorActivity={onCursorActivity}
              lineNumbers={true}
            />
          </div>
        }
        sidebar={
          <TabbedPane
            rightToolbar={
              selectedTab === "locator" || selectedTab === "aria"
                ? [
                    <ToolbarButton
                      key={1}
                      icon="files"
                      title="Copy"
                      onClick={() =>
                        copy(
                          (selectedTab === "locator"
                            ? locator
                            : ariaSnapshot) || ""
                        )
                      }
                    />,
                  ]
                : []
            }
            tabs={[
              {
                id: "locator",
                title: "Locator",
                render: () => (
                  <CodeMirrorWrapper
                    text={locator}
                    placeholder="Type locator to inspect"
                    language={source.language}
                    focusOnChange={selectorFocusOnChange}
                    onChange={onEditorChange}
                    wrapLines={true}
                  />
                ),
              },
              {
                id: "log",
                title: "Log",
                render: () => (
                  <CallLogView
                    language={source.language}
                    log={Array.from(log.values())}
                  />
                ),
              },
              {
                id: "aria",
                title: "Aria",
                render: () => (
                  <CodeMirrorWrapper
                    text={ariaSnapshot || ""}
                    placeholder="Type aria template to match"
                    language={"yaml"}
                    onChange={onAriaEditorChange}
                    highlight={ariaSnapshotErrors}
                    wrapLines={true}
                  />
                ),
              },
            ]}
            selectedTab={selectedTab}
            setSelectedTab={setSelectedTab}
          />
        }
      />
    </div>
  );
};
