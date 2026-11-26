import { useEffect, useId, useState } from 'react';
import type { SettingsSuggestion } from '../../../src/settings-preparation';
import { mailSuggestionSchemas, type MailSuggestionKind, type MailSuggestionValues } from '../settings-suggestions';
import { intervalText, useAccountText } from './account-copy';

export type MailSuggestionProps = { suggestions: SettingsSuggestion[]; onDismissSuggestion(token: number): void };
type Field = keyof MailSuggestionValues;
type Value = string | number | boolean | undefined;
type FormValues = Partial<Record<Field, Value>>;

export function MailSuggestion({ suggestions, onDismissSuggestion, kind, current, baseline, disabled, inferUsername, onApply }: MailSuggestionProps & {
  kind: MailSuggestionKind; current: FormValues; baseline: FormValues;
  disabled: boolean; inferUsername?: boolean; onApply(patch: MailSuggestionValues): void;
}) {
  const first = suggestions[0];
  const openOnly = first && !Object.keys(first.values).length;
  useEffect(() => {
    if (openOnly) onDismissSuggestion(first.token);
  }, [first?.token, openOnly, onDismissSuggestion]);
  if (!first || openOnly) return null;
  return <Review key={first.token} {...{ kind, current, baseline, disabled, inferUsername, onApply }} values={first.values} more={suggestions.length - 1} dismiss={() => onDismissSuggestion(first.token)} />;
}

function Review({ kind, current, baseline, disabled, inferUsername, onApply, values, more, dismiss }: {
  kind: MailSuggestionKind; current: FormValues; baseline: FormValues; disabled: boolean; inferUsername?: boolean;
  values: Record<string, unknown>; more: number; onApply(patch: MailSuggestionValues): void; dismiss(): void;
}) {
  const copy = useAccountText(), heading = useId();
  const [choices, setChoices] = useState<Partial<Record<Field, { from: Value; checked: boolean }>>>({});
  const parsed = mailSuggestionSchemas[kind].safeParse(values);
  const patch: MailSuggestionValues = parsed.success ? { ...parsed.data } : {};
  // Include the normal form defaults in the preview so each applied change is visible.
  if (kind === 'account' && inferUsername && patch.email && patch.username === undefined) patch.username = patch.email;
  if (patch.security && patch.security !== current.security && patch.port === undefined) {
    const [standard, upgraded] = kind === 'smtp' ? [587, 465] : [143, 993];
    if (current.port === standard || current.port === upgraded) patch.port = patch.security === 'tls' ? upgraded : standard;
  }
  if (kind === 'smtp' && patch.username !== undefined && patch.username !== current.username && patch.useImapCredentials === undefined && current.useImapCredentials) patch.useImapCredentials = false;
  const fields = (Object.keys(patch) as Field[]).filter(field => patch[field] !== current[field]);
  const selected = (field: Field) => {
    const choice = choices[field];
    return choice && choice.from === current[field] ? choice.checked : current[field] === baseline[field];
  };
  const reuse = fields.includes('useImapCredentials') && selected('useImapCredentials') ? patch.useImapCredentials : current.useImapCredentials;
  const available = (field: Field) => kind !== 'smtp' || field !== 'username' || !reuse;
  const checked = fields.filter(field => available(field) && selected(field));
  function display(field: Field, value: Value) {
    if (value === undefined || value === '') return copy.empty;
    if (field === 'pollIntervalSeconds' && typeof value === 'number') return intervalText(copy, value);
    if (field === 'security') return value === 'tls' ? copy.directTls : 'STARTTLS';
    if (typeof value === 'boolean') return value ? copy.yes : copy.no;
    return String(value);
  }
  return <section className="mail-suggestion" data-mail-suggestion={kind} aria-labelledby={heading}>
    <strong id={heading}>{copy.suggestion}{more > 0 && <small> · {copy.next(more)}</small>}</strong>
    {fields.length > 0 ? <div className="mail-suggestion-fields">{fields.map(field =>
      <label key={field}>
        <input type="checkbox" data-field={field} aria-label={copy.fields[field]} aria-describedby={`${heading}-${field}`}
          disabled={disabled || !available(field)} checked={available(field) && selected(field)}
          onChange={event => {
            const choice = { from: current[field], checked: event.currentTarget.checked };
            setChoices(previous => ({ ...previous, [field]: choice }));
          }} />
        <span>
          <strong>{copy.fields[field]}</strong>
          <span id={`${heading}-${field}`}>
            {current[field] !== baseline[field] && <small> · {copy.edited}</small>}
            <span className="mail-suggestion-change">
              <span><span className="sr-only">{copy.current} </span>{display(field, current[field])}</span>
              <span aria-hidden="true"> → </span>
              <span><span className="sr-only">{copy.proposed} </span>{display(field, patch[field])}</span>
            </span>
          </span>
        </span>
      </label>)}</div> : <p>{parsed.success ? copy.same : copy.invalidSuggestion}</p>}
    <div className="mail-account-actions">
      <button type="button" className="mail-account-check" onClick={dismiss}>{copy.dismiss}</button>
      {fields.length > 0 && <button type="button" className="mail-account-save" disabled={disabled || !checked.length} onClick={() => { onApply(Object.fromEntries(checked.map(field => [field, patch[field]]))); dismiss(); }}>{copy.apply}</button>}
    </div>
  </section>;
}
