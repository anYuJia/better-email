import type {
  Account,
  MailIdentity,
  MailIdentityInput,
  RemoteImageTrust,
} from '../../app/types';
import IdentitySettingsPage from './pages/IdentitySettingsPage';
import PrivacySettingsPage from './pages/PrivacySettingsPage';

export type ExperienceSettingsProps = {
  section: 'privacy' | 'identities';
  accountForm: Account | null;
  remoteImageTrusts: RemoteImageTrust[];
  identities: MailIdentity[];
  identityForm: MailIdentityInput;
  onAccountFormChange: (account: Account) => void;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onIdentityFormChange: (identity: MailIdentityInput) => void;
  onEditIdentity: (identity: MailIdentity) => void;
  onDeleteIdentity: (identity: MailIdentity) => void;
  onSaveIdentity: () => Promise<void>;
  onNavigateToAi?: () => void;
};

export default function ExperienceSettings(props: ExperienceSettingsProps) {
  const { section } = props;

  if (!props.accountForm) return null;

  if (section === 'privacy') {
    return (
      <PrivacySettingsPage
        accountForm={props.accountForm}
        remoteImageTrusts={props.remoteImageTrusts}
        onAccountFormChange={props.onAccountFormChange}
        onDeleteRemoteImageTrust={props.onDeleteRemoteImageTrust}
        onNavigateToAi={props.onNavigateToAi}
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
