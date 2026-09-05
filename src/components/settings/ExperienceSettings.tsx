import type {
  Account,
  AccountScope,
  MailIdentity,
  MailIdentityInput,
  RemoteImageTrust,
} from '../../app/types';
import IdentitySettingsPage from './pages/IdentitySettingsPage';
import PrivacySettingsPage from './pages/PrivacySettingsPage';
import AccountScopeRequired from './shared/AccountScopeRequired';
import type { SettingsAccountValueChange, SettingsAccountValues } from './accountScopeTypes';

export type ExperienceSettingsProps = {
  section: 'privacy' | 'identities';
  accountScope: AccountScope;
  accounts: Account[];
  accountForm: Account | null;
  accountValues: SettingsAccountValues;
  remoteImageTrusts: RemoteImageTrust[];
  identities: MailIdentity[];
  identityForm: MailIdentityInput;
  onAccountFormChange: (account: Account) => void;
  onAccountValueChange: SettingsAccountValueChange;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onIdentityFormChange: (identity: MailIdentityInput) => void;
  onEditIdentity: (identity: MailIdentity) => void;
  onDeleteIdentity: (identity: MailIdentity) => void;
  onSaveIdentity: () => Promise<void>;
  onNavigateToAi?: () => void;
};

export default function ExperienceSettings(props: ExperienceSettingsProps) {
  const { section } = props;

  if (section === 'privacy') {
    return (
      <PrivacySettingsPage
        accountScope={props.accountScope}
        accounts={props.accounts}
        accountForm={props.accountForm}
        accountValues={props.accountValues}
        remoteImageTrusts={props.remoteImageTrusts}
        onAccountFormChange={props.onAccountFormChange}
        onAccountValueChange={props.onAccountValueChange}
        onDeleteRemoteImageTrust={props.onDeleteRemoteImageTrust}
        onNavigateToAi={props.onNavigateToAi}
      />
    );
  }

  if (props.accountScope === 'all' || !props.accountForm) {
    return (
      <AccountScopeRequired
        accountScope={props.accountScope}
        accounts={props.accounts}
        onSelectAccount={props.onAccountFormChange}
      />
    );
  }

  return (
    <IdentitySettingsPage
      accountForm={props.accountForm}
      identities={props.identities}
      identityForm={props.identityForm}
      onAccountFormChange={props.onAccountFormChange}
      onIdentityFormChange={props.onIdentityFormChange}
      onEditIdentity={props.onEditIdentity}
      onDeleteIdentity={props.onDeleteIdentity}
      onSaveIdentity={props.onSaveIdentity}
    />
  );
}
