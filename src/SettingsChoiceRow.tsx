import type { ComponentPropsWithRef, ReactNode } from 'react';

type ChoiceProps = ComponentPropsWithRef<'select'> & {
  id: string;
  label: string;
  action?: ReactNode;
  error?: string;
};

export function SettingsChoiceRow({ id, label, action, error, hidden, ...select }: ChoiceProps) {
  const errorId = error ? `${id}-error` : undefined;
  return <div className="settings-choice-row" hidden={hidden}>
    <div className="settings-choice-label"><label htmlFor={id}>{label}</label>{action}</div>
    <select {...select} id={id} aria-describedby={[select['aria-describedby'], errorId].filter(Boolean).join(' ') || undefined} />
    {error && <p id={errorId} className="settings-feedback error" role="alert">{error}</p>}
  </div>;
}
