import { createHash, randomUUID } from 'node:crypto';
import { mailCountSchema, mailQuerySchema, type MailCountRequest, type MailCountResult, type MailQueryRequest, type MailQueryResult } from '../../../shared/mail-query';
import { resolveTimeRange, type ResolvedTimeRange } from '../../../shared/time';
import type { ImapFolder, ImapMessage } from '../../../shared/mail';
import type { MailAccountConfig } from './mail-service';
import { countImapMessages, queryImapMessages, type ImapQueryCursor, type ImapQueryResult, type ImapCountResult } from './mail-query-service';
import type { MailOperationContext } from './index';

type Snapshot = { account: MailAccountConfig; epoch: number };
type Target = { accountId: string; folder: string };
type ScopeDetails = { accounts: { id: string; name: string }[]; foldersQueried: number; foldersRequested: number; foldersRemaining: number; copiesCountedSeparately: true; completedAt: string };
type CountResult = MailCountResult & { scopeDetails: ScopeDetails };
type QueryResult = MailQueryResult & { scopeDetails: ScopeDetails };
type PageState = { target: Target; cursor?: ImapQueryCursor; exhausted: boolean };
type Page = { signature: string; states: PageState[]; snapshots: Snapshot[]; range?: ResolvedTimeRange; expires: number; sessionId?: string };
const isQueryResult = (result: ImapQueryResult | ImapCountResult): result is ImapQueryResult => Array.isArray((result as ImapQueryResult).messages);
const MAX_QUERY_FOLDERS = 50;
const CURSOR_LIFETIME_MS = 10 * 60 * 1000;

interface Dependencies {
  accounts(): MailAccountConfig[];
  activeAccountId(): string | undefined;
  snapshot(id: string): Snapshot;
  assertCurrent(snapshot: Snapshot): void;
  folders(id: string): Promise<ImapFolder[]>;
  cache(snapshot: Snapshot, folder: string, messages: ImapQueryResult['messages'], uidValidity: string): ImapMessage[];
  remember(messages: ImapMessage[], context: MailOperationContext): void;
  present(result: MailQueryResult, request: MailQueryRequest): Promise<void>;
}

/** One scoped service is used by the UI and lazily discovered query/count capabilities. */
export function createMailQueryHost(deps: Dependencies) {
  const pages = new Map<string, Page>();
  const assertSnapshots = (snapshots: Snapshot[]) => snapshots.forEach(item => deps.assertCurrent(item));
  const signature = (request: MailQueryRequest) => {
    const { cursor: _cursor, ...rest } = request;
    return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
  };
  function canonical(raw: MailQueryRequest): MailQueryRequest {
    const accounts = deps.accounts();
    if (!accounts.length) throw new Error('Bitte zuerst ein Mailkonto einrichten.');
    const chosen = raw.allAccounts ? undefined : raw.accountId ?? deps.activeAccountId() ?? accounts[0].id;
    if (chosen && !accounts.some(account => account.id === chosen)) throw new Error('Mailkonto nicht gefunden.');
    return { ...(chosen ? { accountId: chosen } : { allAccounts: true }), ...(raw.allFolders ? { allFolders: true } : raw.folders ? { folders: [...new Set(raw.folders)].sort() } : {}), ...(raw.filter ? { filter: raw.filter } : {}), sort: raw.sort ?? 'received_desc', limit: raw.limit ?? 10, ...(raw.cursor ? { cursor: raw.cursor } : {}) };
  }
  async function resolveScope(request: MailQueryRequest, context: MailOperationContext) {
    const accounts = request.allAccounts ? deps.accounts() : deps.accounts().filter(account => account.id === request.accountId);
    const snapshots = accounts.map(account => deps.snapshot(account.id));
    const targets: Target[] = [], warnings: string[] = [];
    let unresolved = 0;
    for (const snapshot of snapshots) {
      context.signal.throwIfAborted(); deps.assertCurrent(snapshot);
      try {
        const folders = (await deps.folders(snapshot.account.id)).filter(item => item.selectable);
        context.signal.throwIfAborted(); deps.assertCurrent(snapshot);
        if (request.allFolders) targets.push(...folders.map(item => ({ accountId: snapshot.account.id, folder: item.path })));
        else if (request.folders) {
          for (const path of request.folders) {
            if (folders.some(item => item.path === path)) targets.push({ accountId: snapshot.account.id, folder: path });
            else { unresolved++; warnings.push(`Ein angegebener Ordner in „${snapshot.account.name}“ ist nicht verfügbar.`); }
          }
        } else {
          const inbox = folders.find(item => item.specialUse?.toLowerCase() === '\\inbox' || item.path.toLowerCase() === 'inbox');
          if (inbox) targets.push({ accountId: snapshot.account.id, folder: inbox.path });
          else { unresolved++; warnings.push(`Kein Posteingang für „${snapshot.account.name}“ verfügbar.`); }
        }
      } catch (error) {
        context.signal.throwIfAborted(); deps.assertCurrent(snapshot);
        unresolved++; warnings.push(`Ordner von „${snapshot.account.name}“ konnten nicht geladen werden.`);
      }
    }
    const unique = [...new Map(targets.map(target => [JSON.stringify(target), target])).values()].sort((a, b) => a.accountId.localeCompare(b.accountId) || a.folder.localeCompare(b.folder));
    if (!unique.length) throw new Error('Keine passenden Mailordner erreichbar. Bitte Konto, Ordner und Verbindung prüfen.');
    const selected = unique.slice(0, MAX_QUERY_FOLDERS);
    const omitted = unique.length - selected.length + unresolved;
    if (unique.length > selected.length) warnings.push(`Die Abfrage berücksichtigt ${MAX_QUERY_FOLDERS} von ${unique.length} Ordnern. Umfang weiter eingrenzen.`);
    return { snapshots, targets: selected, omitted, requested: unique.length + unresolved, warnings };
  }
  function compare(request: MailQueryRequest, a: ImapMessage, b: ImapMessage) {
    const sort = request.sort ?? 'received_desc';
    if (sort === 'uid_desc') return b.uid - a.uid || a.id.localeCompare(b.id);
    const key = sort.startsWith('received_') ? 'receivedAt' : 'date';
    const left = Date.parse(a[key] ?? ''), right = Date.parse(b[key] ?? '');
    // Preserve each folder's UID tie order before consuming a prefix for paging.
    return (sort.endsWith('_asc') ? left - right : right - left) || b.uid - a.uid || a.id.localeCompare(b.id);
  }

  async function execute(raw: unknown, context: MailOperationContext, countOnly: boolean): Promise<CountResult | QueryResult> {
    const parsed = countOnly ? mailCountSchema.parse(raw) : mailQuerySchema.parse(raw);
    const request = canonical(parsed), stamp = new Date();
    context.signal.throwIfAborted();
    for (const [id, page] of pages) if (page.expires <= stamp.getTime()) pages.delete(id);
    const previous = request.cursor ? pages.get(request.cursor) : undefined;
    if (request.cursor && (!previous || previous.signature !== signature(request) || context.origin === 'agent' && previous.sessionId !== context.sessionId)) throw new Error('Diese Abfrageseite ist abgelaufen oder gehört zu anderen Filtern. Bitte die erste Seite neu abrufen.');
    if (previous) assertSnapshots(previous.snapshots);
    context.signal.throwIfAborted();
    const scope = await resolveScope(request, context);
    assertSnapshots(scope.snapshots);
    if (previous && JSON.stringify(previous.states.map(state => state.target)) !== JSON.stringify(scope.targets)) throw new Error('Der Postfachumfang hat sich geändert. Bitte die erste Seite neu abrufen.');
    const range = previous?.range ?? (request.filter?.received ? resolveTimeRange(request.filter.received, stamp) : undefined);
    const states: PageState[] = previous?.states.map(state => ({ ...state })) ?? scope.targets.map(target => ({ target, exhausted: false }));
    if (!countOnly && request.sort === 'uid_desc' && states.length > 1) throw new Error('UID-Sortierung gilt nur innerhalb eines Ordners. Für mehrere Ordner bitte nach Empfang oder Absenderdatum sortieren.');
    type FolderResult = { state: PageState; result: ImapQueryResult | ImapCountResult; messages: ImapMessage[] };
    const responses: FolderResult[] = [];
    const warnings = [...scope.warnings];
    let failures = 0;
    // Every target is revalidated, including exhausted ones, so new arrivals cannot
    // silently alter the ordering between pages.
    for (let offset = 0; offset < states.length; offset += 2) {
      context.signal.throwIfAborted(); assertSnapshots(scope.snapshots);
      const batch = await Promise.allSettled(states.slice(offset, offset + 2).map(async state => {
        const snapshot = scope.snapshots.find(item => item.account.id === state.target.accountId)!;
        const options = { filter: request.filter, resolvedRange: range ? { ...range } : undefined };
        const result = countOnly ? await countImapMessages(snapshot.account, state.target.folder, options, context.signal) : await queryImapMessages(snapshot.account, state.target.folder, { ...options, sort: request.sort, limit: request.limit, cursor: state.cursor }, context.signal);
        context.signal.throwIfAborted(); deps.assertCurrent(snapshot);
        const messages = isQueryResult(result) ? deps.cache(snapshot, state.target.folder, result.messages, result.uidValidity) : [];
        return { state, result, messages };
      }));
      for (const item of batch) {
        if (item.status === 'fulfilled') { responses.push(item.value); warnings.push(...(item.value.result.warnings ?? [])); }
        else {
          context.signal.throwIfAborted(); failures++;
          // A changed list must not produce a cursor that silently skips or repeats rows.
          if (request.cursor) throw new Error('Die Nachrichtenliste wurde geändert oder ist nicht vollständig erreichbar. Bitte die erste Seite neu abrufen.');
          warnings.push('Ein Mailordner konnte nicht abgefragt werden. Die Anzahl ist eine Untergrenze.');
        }
      }
    }
    context.signal.throwIfAborted(); assertSnapshots(scope.snapshots);
    if (!responses.length) throw new Error('Die Mailabfrage konnte nicht ausgeführt werden. Bitte die Verbindung prüfen.');
    const complete = !scope.omitted && !failures && responses.every(item => item.result.complete);
    const countExact = !scope.omitted && !failures && responses.every(item => item.result.countExact);
    const names = scope.snapshots.map(item => item.account.name).join(', ');
    const result: CountResult = {
      count: responses.reduce((sum, item) => sum + item.result.count, 0), countExact, complete,
      scope: `${names} · ${request.allFolders ? 'alle auswählbaren Ordner, Kopien je Ordner getrennt' : request.folders?.join(', ') || 'Posteingang'} · ${responses.length}/${scope.requested} Ordner abgefragt`,
      observedAt: stamp.toISOString(), scannedCount: responses.reduce((sum, item) => sum + item.result.scannedCount, 0), candidateCount: responses.reduce((sum, item) => sum + item.result.candidateCount, 0),
      filter: request.filter ?? {}, ...(range ? { resolvedRange: range } : {}), ...(warnings.length ? { warnings: [...new Set(warnings)].slice(0, 20) } : {}),
      scopeDetails: { accounts: scope.snapshots.map(item => ({ id: item.account.id, name: item.account.name })), foldersQueried: responses.length, foldersRequested: scope.requested, foldersRemaining: scope.omitted + failures, copiesCountedSeparately: true, completedAt: new Date().toISOString() }
    };
    if (countOnly) return result;
    const messages = responses.flatMap(item => item.messages).sort((a, b) => compare(request, a, b)).slice(0, request.limit);
    let hasMore = false;
    const nextStates: PageState[] = responses.map(({ state, result: page, messages: fetched }) => {
      const consumed = messages.filter(message => fetched.some(item => item.id === message.id)).length;
      if (!isQueryResult(page)) return { ...state, exhausted: true };
      const offset = (state.cursor?.offset ?? 0) + consumed;
      const available = fetched.length > consumed || page.hasMore;
      hasMore ||= available;
      return { target: state.target, exhausted: !available, cursor: { offset, uidValidity: page.uidValidity, fingerprint: page.fingerprint } };
    });
    let nextCursor: string | undefined;
    // Partial/unreachable targets cannot be safely resumed as a complete global ordering.
    if (hasMore && complete) {
      nextCursor = randomUUID();
      pages.set(nextCursor, { signature: signature(request), states: nextStates, snapshots: scope.snapshots, range, expires: Date.now() + CURSOR_LIFETIME_MS, ...(context.origin === 'agent' ? { sessionId: context.sessionId } : {}) });
      while (pages.size > 100) pages.delete(pages.keys().next().value!);
    }
    const queryResult: QueryResult = { ...result, messages, hasMore: !!nextCursor, ...(nextCursor ? { nextCursor } : {}), request: { ...request, cursor: undefined } };
    deps.remember(messages, context);
    if (context.origin === 'agent') await deps.present(queryResult, { ...request, cursor: undefined });
    return queryResult;
  }
  return {
    query: (request: unknown, context: MailOperationContext) => execute(request, context, false) as Promise<QueryResult>,
    count: (request: unknown, context: MailOperationContext) => execute(request, context, true) as Promise<CountResult>
  };
}
