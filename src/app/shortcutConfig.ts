export const shortcutGroups = [
  {
    title: '导航',
    items: [
      { keys: ['⌘/Ctrl', 'K'], label: '快速搜索' },
      { keys: ['⌘/Ctrl', 'A'], label: '选择当前列表全部邮件' },
      { keys: ['J', '↓'], label: '下一封' },
      { keys: ['K', '↑'], label: '上一封' },
      { keys: ['Esc'], label: '关闭弹窗 / 取消选择' },
    ],
  },
  {
    title: '写信',
    items: [
      { keys: ['C'], label: '写邮件' },
      { keys: ['R'], label: '回复' },
      { keys: ['A'], label: '回复全部' },
      { keys: ['⇧', 'R'], label: '回复全部（兼容）' },
      { keys: ['F'], label: '转发' },
    ],
  },
  {
    title: '处理邮件',
    items: [
      { keys: ['⌘/Ctrl', 'Z'], label: '撤销上一步邮件操作' },
      { keys: ['S'], label: '星标' },
      { keys: ['M'], label: '已读/未读' },
      { keys: ['E'], label: '归档' },
      { keys: ['#'], label: '移到废纸篓' },
      { keys: ['Delete / Backspace'], label: '移到废纸篓（兼容）' },
    ],
  },
];
