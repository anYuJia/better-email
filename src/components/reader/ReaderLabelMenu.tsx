import { useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import type { Label } from '../../app/types';
import { logError } from '../../app/logger';
import { useDetailsMenu } from '../../hooks/useDetailsMenu';

type ReaderLabelMenuProps = {
  selectedLabels: string[];
  labels: Label[];
  onToggleLabel: (label: Label) => void;
  onCreateLabel?: (name: string, color: string) => Promise<Label>;
  onUpdateLabel?: (id: number, name: string, color: string) => Promise<void>;
  onDeleteLabel?: (id: number) => Promise<void>;
};

export default function ReaderLabelMenu({
  selectedLabels,
  labels,
  onToggleLabel,
  onCreateLabel,
  onUpdateLabel,
  onDeleteLabel,
}: ReaderLabelMenuProps) {
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#2f7ed8');
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [editingLabelName, setEditingLabelName] = useState('');
  const labelMenuRef = useRef<HTMLDetailsElement>(null);
  // 标签菜单支持连续选择/编辑，选中后保持打开；外部点击与 Escape 仍会关闭。
  useDetailsMenu(labelMenuRef);

  async function handleCreateLabel() {
    if (!newLabelName.trim() || !onCreateLabel) return;
    try {
      await onCreateLabel(newLabelName.trim(), newLabelColor);
      setNewLabelName('');
    } catch (e) {
      logError(e);
    }
  }

  async function handleUpdateLabel(id: number) {
    if (!editingLabelName.trim() || !onUpdateLabel) return;
    try {
      await onUpdateLabel(id, editingLabelName.trim(), newLabelColor);
      setEditingLabelId(null);
    } catch (e) {
      logError(e);
    }
  }

  return (
    <div className="label-tools">
      {selectedLabels.map((labelName) => {
        const label = labels.find((item) => item.name === labelName);
        return (
          <span className="active-label-chip" key={labelName}>
            <span className="label-dot" style={{ background: label?.color ?? 'var(--ui-text-tertiary)' }} />
            {labelName}
          </span>
        );
      })}
      <details className="compact-menu label-menu" ref={labelMenuRef}>
        <summary><Tag size={15} /> 标签</summary>
        <div className="label-menu-container">
          <div className="label-menu-add-section">
            <input
              type="text"
              placeholder="新建标签..."
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  await handleCreateLabel();
                }
              }}
            />
            <div className="label-color-selectors">
              {(
                [
                  ['#2f7ed8', '蓝色'],
                  ['#2da44e', '绿色'],
                  ['#d97706', '橙色'],
                  ['#8250df', '紫色'],
                  ['#cf222e', '红色'],
                  ['#6e7781', '灰色'],
                ] as const
              ).map(([c, colorName]) => (
                <button
                  type="button"
                  key={c}
                  className={`color-dot-btn ${newLabelColor === c ? 'active' : ''}`}
                  style={{ background: c }}
                  aria-label={`使用${colorName}标签颜色`}
                  aria-pressed={newLabelColor === c}
                  title={`${colorName}标签颜色`}
                  onClick={() => setNewLabelColor(c)}
                />
              ))}
              <button
                type="button"
                className="label-add-submit-btn"
                disabled={!newLabelName.trim()}
                aria-label="新建标签"
                title="新建标签"
                onClick={handleCreateLabel}
              >
                +
              </button>
            </div>
          </div>

          <div className="label-menu-list">
            {labels.length === 0 ? (
              <div className="label-menu-empty">
                暂无标签，在上方输入名称并点击 + 新建
              </div>
            ) : (
              labels.map((label) => {
                const isEditing = editingLabelId === label.id;
                return (
                  <div className="label-menu-item-row" key={label.id}>
                    {isEditing ? (
                      <div className="label-edit-inline">
                        <input
                          type="text"
                          value={editingLabelName}
                          onChange={(e) => setEditingLabelName(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              await handleUpdateLabel(label.id);
                            }
                          }}
                        />
                        <div className="label-edit-actions">
                          <button type="button" onClick={() => handleUpdateLabel(label.id)}>确定</button>
                          <button type="button" onClick={() => setEditingLabelId(null)}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`label-select-btn ${selectedLabels.includes(label.name) ? 'active' : ''}`}
                          onClick={() => onToggleLabel(label)}
                        >
                          <span className="label-dot" style={{ background: label.color }} />
                          <span className="label-name-text">{label.name}</span>
                        </button>
                        <div className="label-item-actions">
                          <button
                            type="button"
                            className="action-edit"
                            aria-label="编辑名称"
                            title="编辑名称"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLabelId(label.id);
                              setEditingLabelName(label.name);
                            }}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="action-delete"
                            aria-label="删除标签"
                            title="删除标签"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onDeleteLabel) {
                                onDeleteLabel(label.id);
                              }
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
