export type MailRule = {
  id: number;
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
};


export type MailRuleInput = {
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
};

