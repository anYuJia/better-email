import { RefreshCw } from 'lucide-react';
import './contact-sync-loading.css';

type ContactSyncLoadingDialogProps = {
  open: boolean;
};

export default function ContactSyncLoadingDialog({ open }: ContactSyncLoadingDialogProps) {
  if (!open) return null;
  return (
    <div className="contact-sync-loading-backdrop">
      <section
        className="contact-sync-loading-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-sync-loading-title"
        aria-describedby="contact-sync-loading-description"
      >
        <RefreshCw size={20} aria-hidden="true" />
        <div>
          <strong id="contact-sync-loading-title">正在同步最近联系人</strong>
          <p id="contact-sync-loading-description">正在从已发送邮件中扫描同步最近联系人，加入最近联系人列表</p>
        </div>
      </section>
    </div>
  );
}
