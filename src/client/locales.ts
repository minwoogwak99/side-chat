/**
 * Dictionary namespace `sideChat` for the side-chat plugin. `en` is the
 * fallback locale; `zh` mirrors it (LocaleId union is 'zh' | 'en').
 */

/** Dictionary keys owned by the side-chat plugin. */
export type SideChatKey =
  | 'launcher.ask'
  | 'panel.title'
  | 'panel.quoteLabel'
  | 'panel.generating'
  | 'panel.creating'
  | 'panel.empty'
  | 'panel.inputPlaceholder'
  | 'panel.send'
  | 'panel.stop'
  | 'panel.close'

const en: Record<SideChatKey, string> = {
  'launcher.ask': 'Ask about this',
  'panel.title': 'Side chat',
  'panel.quoteLabel': 'Selected passage',
  'panel.generating': 'Generating…',
  'panel.creating': 'Starting side chat…',
  'panel.empty': 'Ask a follow-up question about the selected passage.',
  'panel.inputPlaceholder': 'Ask about the selection…',
  'panel.send': 'Send',
  'panel.stop': 'Stop',
  'panel.close': 'Close side chat',
}

const zh: Record<SideChatKey, string> = {
  'launcher.ask': '追问选中内容',
  'panel.title': '边问对话',
  'panel.quoteLabel': '选中内容',
  'panel.generating': '生成中…',
  'panel.creating': '正在启动边问对话…',
  'panel.empty': '就选中内容提出追问。',
  'panel.inputPlaceholder': '针对选中内容提问…',
  'panel.send': '发送',
  'panel.stop': '停止',
  'panel.close': '关闭边问对话',
}

/** Dictionary namespace id used at registration. */
export const NS = 'sideChat'

/** Registered dictionaries keyed by locale id. */
export const dictionaries: Record<'zh' | 'en', Record<SideChatKey, string>> = { zh, en }
