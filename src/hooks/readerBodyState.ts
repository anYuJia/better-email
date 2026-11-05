import type { Message } from '../app/types';
import { isMessageBodyCorrupted } from '../mailUtils';

export function needsRemoteMessageBody(message: Message) {
  return message.remote_uid > 0 && message.remote_body_fetched !== true
    && ((!message.body.trim() && !message.sanitized_html.trim()) || isMessageBodyCorrupted(message.body));
}

export function readerBodyErrorKind(error: string): 'credentials' | 'network' {
  return /\[credentials_required\]|登录凭据|登录需要恢复|认证失败|authenticationfailed|authentication failed|invalid credentials|login failed|invalid_grant/i.test(error)
    ? 'credentials' : 'network';
}

export function readableBodyError(error: string) {
  return error.replace(/^Error:\s*/i, '').replace(/\[credentials_required\]\s*/g, '');
}
