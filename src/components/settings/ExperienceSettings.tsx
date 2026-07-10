import type {
  Account,
  MailIdentity,
  MailIdentityInput,
  RemoteImageTrust,
} from '../../app/types';
import type { SendUndoDelaySeconds } from '../../app/appConfig';
import type { NotificationPolicy } from '../../mailUtils';
import IdentitySettingsPage from './pages/IdentitySettingsPage';
import NotificationSettingsPage from './pages/NotificationSettingsPage';
import PrivacySettingsPage from './pages/PrivacySettingsPage';
import SendingSettingsPage from './pages/SendingSettingsPage';
import './settings.css';

export type ExperienceSettingsProps = {
  section: 'sending' | 'notifications' | 'privacy' | 'identities';
  accountForm: Account;
  accounts: Account[];
  notificationPolicy: NotificationPolicy;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  remoteImageTrusts: RemoteImageTrust[];
  identities: MailIdentity[];
  identityForm: MailIdentityInput;
  onAccountFormChange: (account: Account) => void;
  onNotificationPolicyChange: (policy: NotificationPolicy) => void;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onIdentityFormChange: (identity: MailIdentityInput) => void;
  onEditIdentity: (identity: MailIdentity) => void;
  onDeleteIdentity: (identity: MailIdentity) => void;
  onSaveIdentity: () => void;
};

export default function ExperienceSettings(props: ExperienceSettingsProps) {
  const { section } = props;

  if (section === 'sending') {
    return (
      <SendingSettingsPage
        sendUndoDelaySeconds={props.sendUndoDelaySeconds}
        onSendUndoDelayChange={props.onSendUndoDelayChange}
      />
    );
  }

  if (section === 'notifications') {
    return (
      <NotificationSettingsPage
        accounts={props.accounts}
        notificationPolicy={props.notificationPolicy}
        onNotificationPolicyChange={props.onNotificationPolicyChange}
      />
    );
  }

  if (section === 'privacy') {
    return (
      <PrivacySettingsPage
        accountForm={props.accountForm}
        remoteImageTrusts={props.remoteImageTrusts}
        onAccountFormChange={props.onAccountFormChange}
        onDeleteRemoteImageTrust={props.onDeleteRemoteImageTrust}
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
