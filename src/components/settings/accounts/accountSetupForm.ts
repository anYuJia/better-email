import type { AccountCreateInput, IncomingProtocol } from '../../../app/types';
import {
  incomingHostForProtocol,
  providerPresetForEmail,
  providerPresets,
} from '../../../providerCatalog';

export function accountFormForEmail(form: AccountCreateInput, email: string): AccountCreateInput {
  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@').pop() ?? '';
  const localPart = email.trim().split('@')[0] || '';
  const preset = providerPresetForEmail(email);

  if (preset) {
    return {
      ...form,
      email,
      display_name: form.display_name || preset.label,
      provider: preset.provider,
      imap_host: incomingHostForProtocol(preset, form.incoming_protocol),
      smtp_host: preset.smtp_host,
      auth_type: 'password',
    };
  }

  const hasDomain = Boolean(domain && domain !== normalizedEmail);
  return {
    ...form,
    email,
    display_name: form.display_name || localPart,
    imap_host: hasDomain
      ? form.incoming_protocol === 'pop3' ? `pop.${domain}:995` : `imap.${domain}:993`
      : form.imap_host,
    smtp_host: hasDomain ? `smtp.${domain}:465` : form.smtp_host,
  };
}

export function accountFormForIncomingProtocol(
  form: AccountCreateInput,
  incomingProtocol: IncomingProtocol,
): AccountCreateInput {
  const preset = providerPresets.find(
    (item) => item.provider === form.provider.trim().toLowerCase() || item.id === form.provider.trim().toLowerCase(),
  );
  const domain = form.email.trim().toLowerCase().split('@').pop() ?? '';
  const hasDomain = Boolean(domain && domain !== form.email.trim().toLowerCase());

  return {
    ...form,
    incoming_protocol: incomingProtocol,
    imap_host: preset
      ? incomingHostForProtocol(preset, incomingProtocol)
      : hasDomain
        ? incomingProtocol === 'pop3' ? `pop.${domain}:995` : `imap.${domain}:993`
        : form.imap_host,
    auth_type: incomingProtocol === 'pop3' && form.auth_type === 'oauth2'
      ? 'password'
      : form.auth_type,
  };
}
