window.__ModuleLoader__.load({
	id: "dsh-plugin-side-chat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/context.ts
		/** Cap for the quoted selection inside the prompt. */
		const QUOTE_MAX_CHARS = 4e3;
		/** Cap for the containing assistant message inside the prompt. */
		const MESSAGE_MAX_CHARS = 4e3;
		/** Cap for one transcript entry inside the prompt. */
		const ENTRY_MAX_CHARS = 1500;
		/** Marker appended to a clipped section. */
		const CLIPPED = "\n…[clipped]";
		/** Read a chat node's (role, text) pair, or null for kinds the transcript skips. */
		function entryOfNode(node) {
			switch (node.kind) {
				case "user":
				case "steering": return {
					role: "user",
					text: node.data.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n\n")
				};
				case "assistant-step": return {
					role: "assistant",
					text: node.data.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("\n\n")
				};
				default: return null;
			}
		}
		/**
		* Flatten a conversation snapshot into a user/assistant text transcript in
		* flow order. Tool calls, commands, retries, and injected context rows are
		* skipped — the prompt needs the dialogue, not the machinery.
		* @param snapshot - main conversation snapshot (event-window projection).
		* @returns entries with non-empty text.
		*/
		function extractTranscript(snapshot) {
			const entries = [];
			for (const key of snapshot.chat.order) {
				const node = snapshot.chat.nodes.get(key);
				if (node === void 0) continue;
				const entry = entryOfNode(node);
				if (entry === null || entry.text.trim() === "") continue;
				entries.push({
					role: entry.role,
					text: entry.text.trim()
				});
			}
			return entries;
		}
		/**
		* Read the full text of one assistant message by its chat node key.
		*
		* @param snapshot - main conversation snapshot.
		* @param nodeKey - the `data-chat-anchor-key` the selection was made in.
		* @returns the message's text blocks joined, or undefined when the key names
		*   no assistant node or carries no text.
		*/
		function assistantMessageText(snapshot, nodeKey) {
			const node = snapshot.chat.nodes.get(nodeKey);
			if (node === void 0 || node.kind !== "assistant-step") return void 0;
			const text = node.data.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("\n\n").trim();
			return text === "" ? void 0 : text;
		}
		/** Clip one section to its cap, appending the clipped marker when it fires. */
		function clip(text, max) {
			return text.length <= max ? text : `${text.slice(0, max)}${CLIPPED}`;
		}
		/**
		* Render the side chat's first user message. The wrapper copy is model-facing
		* English and pinned verbatim: it frames the side conversation so the model
		* answers the question from the passage and context instead of re-deriving
		* the whole original task.
		*
		* @param input - question, quote, optional containing message and transcript.
		* @returns the complete first-prompt text.
		*/
		function buildSideChatPrompt(input) {
			const sections = [];
			sections.push("You are answering in a side conversation. The user selected a passage inside one assistant message of another conversation and asks a follow-up question about it. Answer the question using the passage and the conversation context below; keep the answer self-contained.");
			sections.push(`<selected_passage>\n${clip(input.quote, QUOTE_MAX_CHARS)}\n</selected_passage>`);
			if (input.containingMessage !== void 0 && input.containingMessage.trim() !== "") sections.push(`<containing_assistant_message>\n${clip(input.containingMessage, MESSAGE_MAX_CHARS)}\n</containing_assistant_message>`);
			if (input.transcript.length > 0) {
				const lines = input.transcript.slice(-12).map((entry) => `[${entry.role}]: ${clip(entry.text, ENTRY_MAX_CHARS)}`);
				sections.push(`<recent_conversation>\n${lines.join("\n")}\n</recent_conversation>`);
			}
			sections.push(`<question>\n${input.question}\n</question>`);
			return sections.join("\n\n");
		}
		//#endregion
		//#region src/client/view.ts
		/** Display cap for the quoted snippet in the panel header. */
		const QUOTE_DISPLAY_CHARS = 400;
		/** Clip the quote for display with an explicit marker. */
		function displayQuote(text) {
			return text.length <= QUOTE_DISPLAY_CHARS ? text : `${text.slice(0, QUOTE_DISPLAY_CHARS)}…`;
		}
		/** Transcript entry plus per-node streaming flag, in flow order. */
		function sideRowsOf(snapshot) {
			const rows = [];
			for (const key of snapshot.chat.order) {
				const node = snapshot.chat.nodes.get(key);
				if (node === void 0) continue;
				if (node.kind === "user" || node.kind === "steering") {
					const text = node.data.content.map((block) => block.type === "text" ? block.text : "").filter((text) => text !== "").join("\n\n").trim();
					if (text !== "") rows.push({
						role: "user",
						text,
						state: "final"
					});
				} else if (node.kind === "assistant-step") {
					const data = node.data;
					const text = data.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("\n\n").trim();
					if (text !== "" || data.status === "running") rows.push({
						role: "assistant",
						text,
						state: data.status === "running" ? "streaming" : "final"
					});
				}
			}
			return rows;
		}
		/** Prompt-error copy folded from the side snapshot, if the last op failed. */
		function promptErrorOf(snapshot) {
			const error = snapshot.promptError;
			if (error === null) return void 0;
			return error.error.message === "" ? error.error.code : `${error.error.code}: ${error.error.message}`;
		}
		/**
		* Derive the complete panel view.
		*
		* @param snapshot - side session snapshot, or undefined before the session is bound.
		* @param quote - the selected passage carried by the record.
		* @param state - controller lifecycle state.
		* @returns the immutable view for the panel.
		*/
		function deriveSideView(snapshot, quote, state) {
			const sendError = state.status === "error" ? state.error : void 0;
			return {
				status: state.status,
				error: sendError ?? (snapshot === void 0 ? void 0 : promptErrorOf(snapshot)),
				quote: displayQuote(quote),
				ready: snapshot !== void 0,
				running: snapshot?.running ?? false,
				rows: snapshot === void 0 ? [] : sideRowsOf(snapshot)
			};
		}
		//#endregion
		//#region src/client/controller.ts
		/** Static empty source for scopes whose session has no record (yet). */
		const EMPTY_VIEW = deriveSideView(void 0, "", { status: "idle" });
		const EMPTY_SOURCE = {
			getSnapshot: () => EMPTY_VIEW,
			subscribe: () => () => {}
		};
		/**
		* Owns per-session side-chat records and the panel entry lifecycle.
		* Constructor is cheap and side-effect free; behavior starts on
		* {@link SideChatController.open}.
		*/
		var SideChatController = class {
			#deps;
			#records = /* @__PURE__ */ new Map();
			#disposePanel;
			/** Main session whose side chat currently owns the panel, if any. */
			#activeMainId;
			/**
			* @param deps - service faces plus the panel mount callback.
			*/
			constructor(deps) {
				this.#deps = deps;
			}
			/** Observable view source for one session's panel (empty source when absent). */
			viewOf(sessionId) {
				return this.#records.get(sessionId)?.store ?? EMPTY_SOURCE;
			}
			/**
			* Open the side panel for the current session carrying a new selection.
			* Any live side chat (this session's or another's) is retired first —
			* one panel, one side conversation at a time. The stock details entry
			* stays shadowed until {@link SideChatController.close}.
			* @param hit - validated selection inside an assistant message.
			*/
			open(hit) {
				const list = this.#deps.sessions.list.getSnapshot();
				const current = list.current;
				if (current === void 0) return;
				if (list.byId[current]?.blank !== false) return;
				if (this.#activeMainId !== void 0 && this.#activeMainId !== current) {
					const prior = this.#records.get(this.#activeMainId);
					if (prior !== void 0) this.#retire(prior);
				}
				const record = this.#recordOf(current);
				this.#retire(record);
				record.quote = hit;
				record.status = "idle";
				record.error = void 0;
				this.#activeMainId = current;
				this.#disposePanel ??= this.#deps.mountPanel();
				this.#deps.layout.openDetails();
				this.#publish(record);
			}
			/**
			* Send one follow-up question. The first ask creates the side session and
			* carries the context prompt; later asks are plain messages. Each side
			* snapshot notify republishes the view, so streaming answers render live.
			* @param sessionId - main session whose record owns the side chat.
			* @param question - user question text (non-blank after trim).
			*/
			async ask(sessionId, question) {
				const record = this.#records.get(sessionId);
				if (record === void 0 || record.status === "creating") return;
				const text = question.trim();
				if (text === "") return;
				const epoch = record.epoch;
				try {
					if (record.sideSessionId === void 0) {
						record.status = "creating";
						record.error = void 0;
						this.#publish(record);
						const sideId = await this.#connectSideSession(sessionId);
						if (record.epoch !== epoch) {
							await this.#discardSession(sideId, false);
							return;
						}
						record.sideSessionId = sideId;
						record.status = "idle";
						try {
							await this.#deps.workspaces.archiveSession(sideId);
							record.hidden = true;
						} catch {}
						this.#bindSide(record);
						try {
							await this.#openSideWindow(sideId);
							const prompt = this.#firstPrompt(sessionId, record.quote, text);
							await this.#send(record, prompt);
						} catch (error) {
							if (record.epoch === epoch) await this.#retire(record);
							throw error;
						}
					} else await this.#send(record, text);
				} catch (error) {
					if (record.epoch !== epoch) return;
					record.status = "error";
					record.error = error instanceof Error ? error.message : String(error);
					this.#publish(record);
				}
			}
			/**
			* Cancel the side session's running turn but keep the thread open — the
			* user may still want to ask something else about the same passage.
			* @param sessionId - main session whose record owns the side chat.
			*/
			stop(sessionId) {
				const face = this.#sideFaceOf(sessionId);
				if (face === void 0) return;
				face.cancel().catch(() => {});
			}
			/**
			* Close the panel AND end the one-shot side conversation: cancel any
			* running turn, unbind, archive the side session out of the workspace
			* history, and reset the record. The stock DetailsPanel remounts as the
			* details winner.
			* @param sessionId - main session whose record owns the side chat.
			*/
			close(sessionId) {
				const record = this.#records.get(sessionId);
				if (record !== void 0) this.#retire(record);
				if (this.#activeMainId === sessionId) this.#activeMainId = void 0;
				this.#disposePanel?.();
				this.#disposePanel = void 0;
				this.#deps.layout.closeDetails();
			}
			/** Plugin teardown: drop the panel entry, retire every side chat, clear records. */
			dispose() {
				this.#disposePanel?.();
				this.#disposePanel = void 0;
				this.#activeMainId = void 0;
				for (const record of this.#records.values()) this.#retire(record);
				this.#records.clear();
			}
			#recordOf(sessionId) {
				let record = this.#records.get(sessionId);
				if (record === void 0) {
					record = {
						store: (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(deriveSideView(void 0, "", { status: "idle" })),
						quote: {
							nodeKey: "",
							text: "",
							rect: {
								top: 0,
								left: 0,
								bottom: 0,
								right: 0
							}
						},
						sideSessionId: void 0,
						status: "idle",
						error: void 0,
						unsubscribe: void 0,
						epoch: 0,
						hidden: false
					};
					this.#records.set(sessionId, record);
				}
				return record;
			}
			/**
			* End one record's side conversation: cancel the running turn, unbind the
			* subscription, archive the side session unless it was already archived at
			* creation, and reset the record content. Store identity survives.
			*/
			async #retire(record) {
				record.epoch += 1;
				record.unsubscribe?.();
				record.unsubscribe = void 0;
				const sideId = record.sideSessionId;
				const hidden = record.hidden;
				record.sideSessionId = void 0;
				record.status = "idle";
				record.error = void 0;
				record.quote = {
					nodeKey: "",
					text: "",
					rect: {
						top: 0,
						left: 0,
						bottom: 0,
						right: 0
					}
				};
				record.hidden = false;
				if (sideId !== void 0) await this.#discardSession(sideId, hidden);
				this.#publish(record);
			}
			/**
			* Cancel a session's running turn and archive it out of every history
			* surface. `hidden` skips the archive when the creation-time one already
			* landed (the host set is idempotent, but one archive keeps the wire quiet).
			* @param sideId - session to discard.
			* @param hidden - whether the session is already archived.
			*/
			async #discardSession(sideId, hidden) {
				const face = this.#deps.sessions.binding(sideId)?.session;
				if (face !== void 0) try {
					await face.cancel();
				} catch {}
				if (hidden) return;
				try {
					await this.#deps.workspaces.archiveSession(sideId);
				} catch {}
			}
			/**
			* Open the side session's conversation window without staging it. The
			* public SessionFace contract has no window verb (staging — becoming the
			* current selection — is the only sanctioned opener), so this reaches the
			* concrete Session's idempotent open() through a structural cast. A window
			* is required for live events to fold: cold sessions drop every frame and
			* would leave the panel permanently empty.
			* @param sideId - session whose window should open.
			*/
			async #openSideWindow(sideId) {
				const face = this.#deps.sessions.binding(sideId)?.session;
				const opener = face;
				if (face === void 0 || typeof opener?.open !== "function") throw new Error("side-chat: session window open() unavailable (harness runtime mismatch)");
				await opener.open();
			}
			/** Resolve the workspace holding the main session and connect a blank session in it. */
			async #connectSideSession(mainId) {
				const summary = this.#deps.sessions.list.getSnapshot().byId[mainId];
				const workspaces = this.#deps.workspaces.list.getSnapshot();
				const workspace = workspaces.items.find((item) => item.sessionIds.includes(mainId)) ?? (summary?.cwd === void 0 ? void 0 : workspaces.items.find((item) => item.path === summary.cwd));
				if (workspace === void 0) throw new Error(`side-chat: no workspace found for session ${mainId}`);
				return await this.#deps.workspaces.connectWorkspace(workspace.workspaceId);
			}
			/** Assemble the context-bearing first prompt from the main session snapshot. */
			#firstPrompt(mainId, quote, question) {
				const snapshot = this.#deps.sessions.binding(mainId)?.session.getSnapshot();
				const transcript = snapshot === void 0 ? [] : extractTranscript(snapshot);
				const containingMessage = snapshot === void 0 ? void 0 : assistantMessageText(snapshot, quote.nodeKey);
				return buildSideChatPrompt({
					question,
					quote: quote.text,
					containingMessage,
					transcript
				});
			}
			/** Send one message into the side session, folding a rejected result into the record. */
			async #send(record, text) {
				const result = await this.#requireSideFace(record).prompt([{
					type: "text",
					text
				}], "queue");
				if (record.sideSessionId === void 0) return;
				if (!result.ok) {
					record.status = "error";
					record.error = `${result.error.code}: ${result.error.message}`;
					this.#publish(record);
				}
			}
			#sideFaceOf(sessionId) {
				const record = this.#records.get(sessionId);
				if (record?.sideSessionId === void 0) return void 0;
				return this.#deps.sessions.binding(record.sideSessionId)?.session;
			}
			#requireSideFace(record) {
				const id = record.sideSessionId;
				if (id === void 0) throw new Error("side-chat: side session not connected");
				const face = this.#deps.sessions.binding(id)?.session;
				if (face === void 0) throw new Error(`side-chat: side session ${id} resolved no binding`);
				return face;
			}
			/** Subscribe the record to its side session's snapshot and publish immediately. */
			#bindSide(record) {
				record.unsubscribe?.();
				record.unsubscribe = void 0;
				record.unsubscribe = this.#requireSideFace(record).subscribe(() => {
					this.#publish(record);
				});
				this.#publish(record);
			}
			#publish(record) {
				const snapshot = record.sideSessionId === void 0 ? void 0 : this.#deps.sessions.binding(record.sideSessionId)?.session.getSnapshot();
				record.store.set(deriveSideView(snapshot, record.quote.text, {
					status: record.status,
					error: record.error
				}));
			}
		};
		/** Chat row kinds the launcher may quote from (assistant messages only). */
		const QUOTABLE_KINDS = /* @__PURE__ */ new Set(["assistant-step"]);
		/** Resolve the enclosing chat row of a selection endpoint, if any. */
		function chatRowOf(node) {
			return (node instanceof Element ? node : node?.parentElement ?? null)?.closest("[data-chat-anchor-key]") ?? null;
		}
		/**
		* Read the current selection as a quotable assistant passage.
		*
		* @param selection - the live browser selection (usually `window.getSelection()`).
		* @returns the hit, or null when nothing is selected, the selection crosses
		*   rows or targets a non-assistant row, or the text exceeds
		*   {@link MAX_SELECTION_CHARS}.
		*/
		function readAssistantSelection(selection) {
			if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
			const anchorRow = chatRowOf(selection.anchorNode);
			const focusRow = chatRowOf(selection.focusNode);
			if (anchorRow === null || anchorRow !== focusRow) return null;
			if (!QUOTABLE_KINDS.has(anchorRow.dataset.chatFlowKind ?? "")) return null;
			const nodeKey = anchorRow.dataset.chatAnchorKey;
			if (nodeKey === void 0 || nodeKey === "") return null;
			const text = selection.toString().replace(/\s+/g, " ").trim();
			if (text === "" || text.length > 8e3) return null;
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			return {
				nodeKey,
				text,
				rect: {
					top: rect.top,
					left: rect.left,
					bottom: rect.bottom,
					right: rect.right
				}
			};
		}
		//#endregion
		//#region \0side-chat-css:/Users/minwoo/Dev/DSH-plugins/side-chat/src/client/SelectionLauncher.module.css.mjs
		const css$1 = ".Ts4oDq_layer{pointer-events:none;position:absolute;inset:0}.Ts4oDq_ask{border:1px solid var(--dsw-alias-border-l2);box-sizing:border-box;background:var(--dsw-alias-button-elevated-fill);max-width:200px;color:var(--dsw-alias-label-primary);cursor:pointer;pointer-events:auto;border-radius:999px;align-items:center;gap:6px;padding:5px 10px;font-family:inherit;font-size:12px;font-weight:500;line-height:18px;display:inline-flex;position:absolute;box-shadow:0 4px 12px #0000001f}.Ts4oDq_ask:hover{background:var(--dsw-alias-button-floating-hover)}.Ts4oDq_ask:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.Ts4oDq_askLabel{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}";
		const tagId$1 = "dsh-plugin-side-chat/SelectionLauncher.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-side-chat";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var SelectionLauncher_module_css_default = {
			"ask": "Ts4oDq_ask",
			"askLabel": "Ts4oDq_askLabel",
			"layer": "Ts4oDq_layer"
		};
		//#endregion
		//#region src/client/SelectionLauncher.tsx
		/**
		* Selection launcher: the always-mounted `shell.overlay` entry. Watches the
		* document selection; when a non-empty selection sits inside one assistant
		* chat row, shows a floating "Ask about this" button above it. Clicking hands
		* the validated hit to the controller (which opens the side panel) and clears
		* the selection. Pure presentation — detection logic lives in selection.ts,
		* actions arrive through the inject face.
		*/
		/** Button placement offset above the selection rect. */
		const BUTTON_OFFSET = 6;
		/** Viewport/layer clamping margin. */
		const EDGE_MARGIN = 4;
		/**
		* The launcher surface: an inert full-size layer with one absolutely
		* positioned button. Local state only — the hit lives until the selection
		* collapses, a scroll moves it, Escape dismisses it, or the button is used.
		*/
		function SelectionLauncher({ openSelection, t }) {
			const layerRef = (0, react.useRef)(null);
			const buttonRef = (0, react.useRef)(null);
			const [hit, setHit] = (0, react.useState)(null);
			const [pos, setPos] = (0, react.useState)(null);
			const recompute = (0, react.useCallback)(() => {
				const next = readAssistantSelection(window.getSelection());
				if (next === null) {
					setHit(null);
					setPos(null);
					return;
				}
				const layerRect = layerRef.current?.getBoundingClientRect();
				setHit(next);
				if (layerRect === void 0) return;
				setPos({
					top: Math.max(EDGE_MARGIN, next.rect.top - layerRect.top - 28 - BUTTON_OFFSET),
					left: Math.min(Math.max(EDGE_MARGIN, next.rect.left - layerRect.left), Math.max(EDGE_MARGIN, layerRect.width - 140))
				});
			}, []);
			(0, react.useEffect)(() => {
				const documentRef = document;
				let frame = null;
				const onSelectionChange = () => {
					if (frame !== null) return;
					frame = requestAnimationFrame(() => {
						frame = null;
						recompute();
					});
				};
				const onMouseUp = () => {
					recompute();
				};
				const onKeyUp = (event) => {
					if (event.shiftKey || event.key === "Escape") recompute();
				};
				const onScroll = () => {
					if (frame !== null) cancelAnimationFrame(frame);
					frame = null;
					setHit(null);
					setPos(null);
				};
				const onMouseDown = (event) => {
					if (event.target instanceof Node && buttonRef.current?.contains(event.target) === true) return;
					if (frame !== null) cancelAnimationFrame(frame);
					frame = null;
					setHit(null);
					setPos(null);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						setHit(null);
						setPos(null);
					}
				};
				documentRef.addEventListener("selectionchange", onSelectionChange);
				documentRef.addEventListener("mouseup", onMouseUp);
				documentRef.addEventListener("keyup", onKeyUp);
				documentRef.addEventListener("scroll", onScroll, {
					capture: true,
					passive: true
				});
				documentRef.addEventListener("mousedown", onMouseDown);
				documentRef.addEventListener("keydown", onKeyDown);
				return () => {
					documentRef.removeEventListener("selectionchange", onSelectionChange);
					documentRef.removeEventListener("mouseup", onMouseUp);
					documentRef.removeEventListener("keyup", onKeyUp);
					documentRef.removeEventListener("scroll", onScroll, { capture: true });
					documentRef.removeEventListener("mousedown", onMouseDown);
					documentRef.removeEventListener("keydown", onKeyDown);
					if (frame !== null) cancelAnimationFrame(frame);
				};
			}, [recompute]);
			const onAsk = (0, react.useCallback)(() => {
				if (hit === null) return;
				openSelection(hit);
				window.getSelection()?.removeAllRanges();
				setHit(null);
				setPos(null);
			}, [hit, openSelection]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: layerRef,
				className: SelectionLauncher_module_css_default.layer,
				children: hit !== null && pos !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					ref: buttonRef,
					type: "button",
					className: SelectionLauncher_module_css_default.ask,
					style: {
						top: pos.top,
						left: pos.left
					},
					onClick: onAsk,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						viewBox: "0 0 16 16",
						width: "14",
						height: "14",
						"aria-hidden": true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.4",
							strokeLinejoin: "round"
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SelectionLauncher_module_css_default.askLabel,
						children: t("launcher.ask")
					})]
				})
			});
		}
		//#endregion
		//#region \0side-chat-css:/Users/minwoo/Dev/DSH-plugins/side-chat/src/client/SideChatPanel.module.css.mjs
		const css = ".i9VQMW_root{border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;height:100%;display:flex}.i9VQMW_header{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:8px;padding:14px 12px 12px;display:flex}.i9VQMW_title{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}.i9VQMW_close{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;display:grid}.i9VQMW_close:hover{background:var(--dsw-alias-interactive-bg-hover)}.i9VQMW_close:focus-visible,.i9VQMW_primary:focus-visible,.i9VQMW_secondary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.i9VQMW_quote{border-left:3px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover);margin:0;padding:10px 12px}.i9VQMW_quoteLabel{color:var(--dsw-alias-label-tertiary);margin-bottom:4px;font-size:11px;font-weight:500;line-height:16px}.i9VQMW_quoteText{color:var(--dsw-alias-label-secondary);word-break:break-word;-webkit-line-clamp:4;-webkit-box-orient:vertical;font-size:12px;line-height:19px;display:-webkit-box;overflow:hidden}.i9VQMW_body{flex:1;min-height:0;padding:12px;overflow-y:auto}.i9VQMW_empty{color:var(--dsw-alias-label-tertiary);padding:8px 0;font-size:13px;line-height:20px}.i9VQMW_row{margin-bottom:10px;display:flex}.i9VQMW_row[data-role=user]{justify-content:flex-end}.i9VQMW_bubbleUser,.i9VQMW_bubbleAssistant{word-break:break-word;white-space:pre-wrap;border-radius:10px;max-width:92%;padding:8px 10px;font-size:13px;line-height:20px}.i9VQMW_bubbleUser{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary)}.i9VQMW_bubbleAssistant{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.i9VQMW_streaming{margin-left:1px;animation:1s steps(2,start) infinite i9VQMW_side-chat-blink}@keyframes i9VQMW_side-chat-blink{to{visibility:hidden}}@media (prefers-reduced-motion:reduce){.i9VQMW_streaming{animation:none}}.i9VQMW_error{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-label-primary);word-break:break-word;border-radius:8px;margin-top:4px;padding:8px 10px;font-size:12px;line-height:18px}.i9VQMW_composer{border-top:1px solid var(--dsw-alias-border-l2);flex:none;padding:10px 12px 12px}.i9VQMW_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);width:100%;color:var(--dsw-alias-label-primary);resize:vertical;border-radius:10px;padding:8px 10px;font-family:inherit;font-size:13px;line-height:20px}.i9VQMW_input::placeholder{color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption)}.i9VQMW_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.i9VQMW_input:disabled{opacity:.6}.i9VQMW_controls{justify-content:flex-end;gap:8px;margin-top:8px;display:flex}.i9VQMW_primary,.i9VQMW_secondary{cursor:pointer;border-radius:999px;padding:5px 14px;font-family:inherit;font-size:12px;font-weight:500;line-height:18px}.i9VQMW_primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:none}.i9VQMW_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.i9VQMW_primary:disabled{background:var(--dsw-alias-button-primary-dimmed);cursor:default}.i9VQMW_secondary{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);background:0 0}.i9VQMW_secondary:hover{background:var(--dsw-alias-interactive-bg-hover)}";
		const tagId = "dsh-plugin-side-chat/SideChatPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-side-chat";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SideChatPanel_module_css_default = {
			"body": "i9VQMW_body",
			"bubbleAssistant": "i9VQMW_bubbleAssistant",
			"bubbleUser": "i9VQMW_bubbleUser",
			"close": "i9VQMW_close",
			"composer": "i9VQMW_composer",
			"controls": "i9VQMW_controls",
			"empty": "i9VQMW_empty",
			"error": "i9VQMW_error",
			"header": "i9VQMW_header",
			"input": "i9VQMW_input",
			"primary": "i9VQMW_primary",
			"quote": "i9VQMW_quote",
			"quoteLabel": "i9VQMW_quoteLabel",
			"quoteText": "i9VQMW_quoteText",
			"root": "i9VQMW_root",
			"row": "i9VQMW_row",
			"secondary": "i9VQMW_secondary",
			"side-chat-blink": "i9VQMW_side-chat-blink",
			"streaming": "i9VQMW_streaming",
			"title": "i9VQMW_title"
		};
		//#endregion
		//#region src/client/SideChatPanel.tsx
		/**
		* Side-chat panel: the session-scoped `details` shadow entry. Renders the
		* quoted selection, the side conversation transcript, and a minimal composer.
		* Everything reactive arrives through the bound `useSideChat` hook (the
		* record's snapshot store); every action is an injected callback. The draft
		* is component-local state — it lives exactly as long as this mount.
		*/
		/**
		* The panel surface. Auto-focuses the composer on mount so a follow-up can be
		* typed immediately after the selection click.
		*/
		function SideChatPanel({ useSideChat, ask, stop, close, t }) {
			const view = useSideChat((s) => s);
			const [draft, setDraft] = (0, react.useState)("");
			const inputRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				inputRef.current?.focus();
			}, []);
			const submit = (0, react.useCallback)(() => {
				const text = draft.trim();
				if (text === "" || view.status === "creating") return;
				ask(text);
				setDraft("");
			}, [
				ask,
				draft,
				view.status
			]);
			const onDraftKeyDown = (0, react.useCallback)((event) => {
				if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
					event.preventDefault();
					submit();
				}
			}, [submit]);
			const sending = view.status === "creating";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: SideChatPanel_module_css_default.root,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SideChatPanel_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: SideChatPanel_module_css_default.title,
							children: t("panel.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: SideChatPanel_module_css_default.close,
							"aria-label": t("panel.close"),
							onClick: close,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
								viewBox: "0 0 16 16",
								width: "14",
								height: "14",
								"aria-hidden": true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
									d: "M4 4l8 8M12 4l-8 8",
									stroke: "currentColor",
									strokeWidth: "1.5",
									strokeLinecap: "round"
								})
							})
						})]
					}),
					view.quote !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("blockquote", {
						className: SideChatPanel_module_css_default.quote,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: SideChatPanel_module_css_default.quoteLabel,
							children: t("panel.quoteLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: SideChatPanel_module_css_default.quoteText,
							children: view.quote
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SideChatPanel_module_css_default.body,
						role: "log",
						"aria-live": "polite",
						children: [
							view.rows.length === 0 && !view.running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SideChatPanel_module_css_default.empty,
								children: sending ? t("panel.creating") : t("panel.empty")
							}),
							view.rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SideChatPanel_module_css_default.row,
								"data-role": row.role,
								"data-state": row.state,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: row.role === "user" ? SideChatPanel_module_css_default.bubbleUser : SideChatPanel_module_css_default.bubbleAssistant,
									children: [row.text === "" && row.state === "streaming" ? t("panel.generating") : row.text, row.text !== "" && row.state === "streaming" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SideChatPanel_module_css_default.streaming,
										children: "▍"
									})]
								})
							}, index)),
							view.running && view.rows[view.rows.length - 1]?.state !== "streaming" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SideChatPanel_module_css_default.row,
								"data-role": "assistant",
								"data-state": "streaming",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: SideChatPanel_module_css_default.bubbleAssistant,
									children: t("panel.generating")
								})
							}),
							view.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SideChatPanel_module_css_default.error,
								role: "alert",
								children: view.error
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SideChatPanel_module_css_default.composer,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							ref: inputRef,
							className: SideChatPanel_module_css_default.input,
							rows: 2,
							value: draft,
							placeholder: t("panel.inputPlaceholder"),
							disabled: sending,
							onChange: (event) => {
								setDraft(event.target.value);
							},
							onKeyDown: onDraftKeyDown,
							"aria-label": t("panel.inputPlaceholder")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SideChatPanel_module_css_default.controls,
							children: [view.running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SideChatPanel_module_css_default.secondary,
								onClick: stop,
								children: t("panel.stop")
							}) : void 0, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SideChatPanel_module_css_default.primary,
								disabled: sending || draft.trim() === "",
								onClick: submit,
								children: t("panel.send")
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const en = {
			"launcher.ask": "Ask about this",
			"panel.title": "Side chat",
			"panel.quoteLabel": "Selected passage",
			"panel.generating": "Generating…",
			"panel.creating": "Starting side chat…",
			"panel.empty": "Ask a follow-up question about the selected passage.",
			"panel.inputPlaceholder": "Ask about the selection…",
			"panel.send": "Send",
			"panel.stop": "Stop",
			"panel.close": "Close side chat"
		};
		const zh = {
			"launcher.ask": "追问选中内容",
			"panel.title": "边问对话",
			"panel.quoteLabel": "选中内容",
			"panel.generating": "生成中…",
			"panel.creating": "正在启动边问对话…",
			"panel.empty": "就选中内容提出追问。",
			"panel.inputPlaceholder": "针对选中内容提问…",
			"panel.send": "发送",
			"panel.stop": "停止",
			"panel.close": "关闭边问对话"
		};
		/** Dictionary namespace id used at registration. */
		const NS = "sideChat";
		/** Registered dictionaries keyed by locale id. */
		const dictionaries = {
			zh,
			en
		};
		//#endregion
		//#region src/client/index.ts
		/** Required services: slot registry, panel geometry, session/workspace faces, and copy. */
		const inject = [
			"slots",
			"layout",
			"sessions",
			"workspaces",
			"locale"
		];
		/**
		* Client plugin body: dictionaries, the resident launcher, and the
		* controller owning the on-demand panel entry.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, dictionaries), "side-chat: dictionaries");
			const controller = new SideChatController({
				sessions: ctx.sessions,
				workspaces: ctx.workspaces,
				layout: ctx.layout,
				mountPanel: () => ctx.slots.inject("details", () => ctx.slots.register({
					name: "details",
					priority: -100,
					locale: NS,
					inject: (sessionId) => ({
						ask: (question) => {
							controller.ask(sessionId, question);
						},
						stop: () => {
							controller.stop(sessionId);
						},
						close: () => {
							controller.close(sessionId);
						},
						hooks: { sideChat: controller.viewOf(sessionId) }
					})
				}, SideChatPanel))
			});
			ctx.effect(() => {
				const dispose = ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "side-chat-launcher",
					order: 100,
					locale: NS,
					inject: () => ({ openSelection: (hit) => {
						controller.open(hit);
					} })
				}, SelectionLauncher));
				return () => {
					dispose();
					controller.dispose();
				};
			}, "side-chat: launcher + controller");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map