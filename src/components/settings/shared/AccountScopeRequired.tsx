import { UserRound } from 'lucide-react';
import type { AccountScope } from '../../../app/types';
import SettingsNotice from './SettingsNotice';
import SettingsSection from './SettingsSection';

type AccountScopeRequiredProps = {
  title?: string;
  description?: string;
  accountScope?: AccountScope;
};

/** Shared empty state for settings that cannot be edited in unified scope. */
export default function AccountScopeRequired({
  title = '请选择具体邮箱账号',
  description = '服务器、登录凭据、发件身份和文件夹映射只属于一个邮箱账号。请使用顶部的邮箱范围选择器后继续。',
  accountScope = 'all',
}: AccountScopeRequiredProps) {
  return (
    <SettingsSection dataSection="account-scope-required">
      <SettingsNotice
        tone="info"
        icon={UserRound}
        title={title}
      >
        <p data-account-scope-required={String(accountScope)}>{description}</p>
      </SettingsNotice>
    </SettingsSection>
  );
}
