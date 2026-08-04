import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Label } from '../app/types';
import { invoke } from '../tauriBridge';

type LabelManagementOptions = {
  labels: Label[];
  setLabels: Dispatch<SetStateAction<Label[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useLabelManagement({
  labels,
  setLabels,
  setStatus,
}: LabelManagementOptions) {
  const [confirmDeleteLabel, setConfirmDeleteLabel] = useState<Label | null>(null);

  async function handleCreateLabel(name: string, color: string) {
    const newLabel = await invoke<Label>('create_label', { name, color });
    setLabels((current) => [...current, newLabel].sort((a, b) => a.name.localeCompare(b.name)));
    return newLabel;
  }

  async function handleUpdateLabel(id: number, name: string, color: string) {
    await invoke('update_label', { id, name, color });
    setLabels((current) =>
      current
        .map((l) => (l.id === id ? { ...l, name, color } : l))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  async function handleDeleteLabelConfirmed(id: number) {
    await invoke('delete_label', { id });
    setLabels((current) => current.filter((l) => l.id !== id));
  }

  async function handleDeleteLabel(id: number) {
    const label = labels.find((l) => l.id === id);
    if (label) {
      setConfirmDeleteLabel(label);
    }
  }

  return {
    confirmDeleteLabel,
    setConfirmDeleteLabel,
    handleCreateLabel,
    handleUpdateLabel,
    handleDeleteLabelConfirmed,
    handleDeleteLabel,
  };
}
