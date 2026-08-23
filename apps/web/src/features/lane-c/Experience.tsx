"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ScreenKind } from "../../lib/prototype/types";
import {
  analyticsFixture,
  approvalFixture,
  contentKinds,
  demoAuditEvents,
  demoContents,
  demoDeletionRequests,
  demoJobs,
  demoUsers,
  type ContentKind,
  type DemoJob,
  type DemoJobStatus,
  type DemoUser,
} from "./fixtures";
import styles from "./Experience.module.css";

type ConfirmationTone = "standard" | "danger";

function Feedback({ message, tone = "success" }: { message: string; tone?: "success" | "warning" }) {
  if (!message) return null;
  return (
    <div className={styles.feedback} data-tone={tone} role="status">
      <strong>{tone === "success" ? "完了" : "確認してください"}</strong>
      <span>{message}</span>
    </div>
  );
}

function DangerConfirmation({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  requiredPhrase,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: ConfirmationTone;
  requiredPhrase?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [phrase, setPhrase] = useState("");

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        const dialog = cancelRef.current?.closest<HTMLElement>("[role='dialog']");
        const focusable = dialog ? [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")] : [];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;
  const canConfirm = !requiredPhrase || phrase === requiredPhrase;
  return (
    <div className={styles.backdrop}>
      <section aria-describedby="lane-c-dialog-description" aria-labelledby="lane-c-dialog-title" aria-modal="true" className={styles.dialog} role="dialog">
        <span className={styles.dialogMark} data-tone={tone} aria-hidden="true">{tone === "danger" ? "!" : "✓"}</span>
        <h2 id="lane-c-dialog-title">{title}</h2>
        <p id="lane-c-dialog-description">{description}</p>
        {requiredPhrase ? (
          <label className={styles.field}>
            確認のため「{requiredPhrase}」と入力
            <input autoComplete="off" value={phrase} onChange={(event) => setPhrase(event.target.value)} />
          </label>
        ) : null}
        <div className={styles.dialogActions}>
          <button ref={cancelRef} className={styles.secondaryButton} type="button" onClick={onCancel}>キャンセル</button>
          <button className={tone === "danger" ? styles.dangerButton : styles.primaryButton} disabled={!canConfirm} type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function UsersExperience() {
  const [users, setUsers] = useState(demoUsers);
  const [selectedId, setSelectedId] = useState(demoUsers[0].id);
  const [roleDraft, setRoleDraft] = useState<DemoUser["role"]>(demoUsers[0].role);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<"role" | "disable" | "sessions" | null>(null);
  const [feedback, setFeedback] = useState("");
  const selected = users.find((user) => user.id === selectedId) ?? users[0];

  function selectUser(user: DemoUser) {
    setSelectedId(user.id);
    setRoleDraft(user.role);
    setFeedback("");
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const name = String(data.get("name") ?? "");
    if (!email.endsWith(".invalid") || !name.trim()) {
      setFeedback("匿名の名前と example.invalid のメールアドレスを入力してください。");
      return;
    }
    setFeedback(`${name}へ招待を送信しました。`);
    setInviteOpen(false);
    event.currentTarget.reset();
  }

  function confirmImpact() {
    if (confirmation === "role") {
      setUsers((current) => current.map((user) => user.id === selected.id ? { ...user, role: roleDraft } : user));
      setFeedback(`${selected.name}の権限を${roleDraft}へ変更しました。`);
    }
    if (confirmation === "disable") {
      setUsers((current) => current.map((user) => user.id === selected.id ? { ...user, state: "disabled", sessions: 0 } : user));
      setFeedback(`${selected.name}を利用停止し、セッションを失効しました。`);
    }
    if (confirmation === "sessions") {
      setUsers((current) => current.map((user) => user.id === selected.id ? { ...user, sessions: 0 } : user));
      setFeedback(`${selected.name}のセッションを失効しました。`);
    }
    setConfirmation(null);
  }

  const dialogCopy = confirmation === "role"
    ? { title: "権限変更の影響を確認", description: `${selected.name}の権限を${selected.role}から${roleDraft}へ変更します。担当中ジョブは${selected.activeJobs}件です。`, label: "権限を変更" }
    : confirmation === "disable"
      ? { title: "利用停止の影響を確認", description: `${selected.name}を停止し、${selected.sessions}件のセッションを失効します。担当中ジョブは自動移管されません。`, label: "利用を停止" }
      : { title: "セッション失効を確認", description: `${selected.name}の有効なセッション${selected.sessions}件を失効します。`, label: "セッションを失効" };

  return (
    <section className={styles.experience} aria-label="利用者と権限">
      <div className={styles.toolbar}>
        <label className={styles.searchField}>利用者を検索<input type="search" placeholder="匿名名・所属" /></label>
        <button className={styles.primaryButton} type="button" onClick={() => setInviteOpen((value) => !value)}>利用者を招待</button>
      </div>
      <Feedback message={feedback} tone={feedback.includes("入力") ? "warning" : "success"} />
      {inviteOpen ? (
        <form className={styles.inlineForm} onSubmit={invite}>
          <h3>匿名利用者を招待</h3>
          <label className={styles.field}>表示名<input name="name" defaultValue="匿名査定員D" /></label>
          <label className={styles.field}>メールアドレス<input name="email" type="email" defaultValue="user-d@example.invalid" /></label>
          <div className={styles.inlineActions}><button className={styles.secondaryButton} type="button" onClick={() => setInviteOpen(false)}>閉じる</button><button className={styles.primaryButton} type="submit">招待を確認</button></div>
        </form>
      ) : null}
      <div className={styles.masterDetail}>
        <div className={styles.listPanel}>
          <h3>利用者一覧</h3>
          <ul className={styles.selectionList}>
            {users.map((user) => (
              <li key={user.id}>
                <button aria-pressed={selected.id === user.id} type="button" onClick={() => selectUser(user)}>
                  <strong>{user.name}</strong><span>{user.branch}・{user.role}</span><small data-state={user.state}>{user.state}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <article className={styles.detailPanel}>
          <div className={styles.detailHeading}><div><p>選択中</p><h3>{selected.name}</h3></div><span className={styles.stateBadge} data-state={selected.state}>{selected.state}</span></div>
          <dl className={styles.definitionList}><div><dt>所属</dt><dd>{selected.branch}</dd></div><div><dt>メール</dt><dd>{selected.email}</dd></div><div><dt>有効セッション</dt><dd>{selected.sessions}件</dd></div><div><dt>担当中ジョブ</dt><dd>{selected.activeJobs}件</dd></div></dl>
          <label className={styles.field}>権限<select value={roleDraft} onChange={(event) => setRoleDraft(event.target.value as DemoUser["role"])}><option value="assessor">assessor</option><option value="manager">manager</option><option value="educator">educator</option></select></label>
          <div className={styles.actionRow}>
            <button className={styles.primaryButton} disabled={roleDraft === selected.role || selected.state === "disabled"} type="button" onClick={() => setConfirmation("role")}>影響を確認して変更</button>
            <button className={styles.secondaryButton} disabled={selected.sessions === 0} type="button" onClick={() => setConfirmation("sessions")}>セッション失効</button>
            <button className={styles.dangerGhostButton} disabled={selected.state === "disabled"} type="button" onClick={() => setConfirmation("disable")}>利用停止</button>
          </div>
        </article>
      </div>
      <DangerConfirmation open={confirmation !== null} title={dialogCopy.title} description={dialogCopy.description} confirmLabel={dialogCopy.label} tone={confirmation === "role" ? "standard" : "danger"} onCancel={() => setConfirmation(null)} onConfirm={confirmImpact} />
    </section>
  );
}

function JobsExperience() {
  const [jobs, setJobs] = useState<DemoJob[]>(demoJobs);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DemoJobStatus>("all");
  const [selectedId, setSelectedId] = useState(demoJobs[1].id);
  const [confirmation, setConfirmation] = useState<"retry" | "cancel" | null>(null);
  const [feedback, setFeedback] = useState("");
  const selected = jobs.find((job) => job.id === selectedId) ?? jobs[0];
  const visible = jobs.filter((job) => {
    const matchesQuery = `${job.id} ${job.type} ${job.entity} ${job.requestId}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (statusFilter === "all" || job.status === statusFilter);
  });

  function confirmJobAction() {
    if (confirmation === "retry") {
      setJobs((current) => current.map((job) => job.id === selected.id ? {
        ...job,
        status: "running",
        nextRetry: null,
        safeError: null,
        attempts: [{ number: job.attempts.length + 1, result: "手動再試行を受付", at: "現在" }, ...job.attempts],
      } : job));
      setFeedback(`${selected.id}を再試行しました。`);
    }
    if (confirmation === "cancel") {
      setJobs((current) => current.map((job) => job.id === selected.id ? { ...job, status: "cancelled", nextRetry: null } : job));
      setFeedback(`${selected.id}の取消を受け付けました。`);
    }
    setConfirmation(null);
  }

  const retryable = selected.status === "failed" || selected.status === "retry_wait";
  const cancellable = ["queued", "running", "retry_wait"].includes(selected.status);
  return (
    <section className={styles.experience} aria-label="案件とジョブ">
      <div className={styles.toolbar}>
        <label className={styles.searchField}>ジョブ・request IDを検索<input value={query} type="search" onChange={(event) => setQuery(event.target.value)} /></label>
        <label className={styles.compactField}>状態<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | DemoJobStatus)}><option value="all">すべて</option><option value="queued">queued</option><option value="running">running</option><option value="retry_wait">retry_wait</option><option value="failed">failed</option><option value="cancelled">cancelled</option></select></label>
      </div>
      <Feedback message={feedback} />
      <div className={styles.masterDetail}>
        <div className={styles.listPanel}>
          <div className={styles.panelTitle}><h3>検索結果</h3><span>{visible.length}件</span></div>
          {visible.length ? <ul className={styles.selectionList}>{visible.map((job) => <li key={job.id}><button aria-pressed={selected.id === job.id} type="button" onClick={() => setSelectedId(job.id)}><strong>{job.type}</strong><span>{job.entity}・{job.age}</span><small data-state={job.status}>{job.status}</small></button></li>)}</ul> : <p className={styles.empty}>条件に一致するジョブはありません。</p>}
        </div>
        <article className={styles.detailPanel}>
          <div className={styles.detailHeading}><div><p>ジョブ詳細</p><h3>{selected.id}</h3></div><span className={styles.stateBadge} data-state={selected.status}>{selected.status}</span></div>
          <dl className={styles.definitionList}><div><dt>種別</dt><dd>{selected.type}</dd></div><div><dt>対象</dt><dd>{selected.entity}</dd></div><div><dt>request ID</dt><dd><code>{selected.requestId}</code></dd></div><div><dt>次回再試行</dt><dd>{selected.nextRetry ?? "なし"}</dd></div></dl>
          {selected.safeError ? <div className={styles.warningBox}><strong>安全なエラー</strong><span>{selected.safeError}</span></div> : null}
          <section className={styles.timeline} aria-labelledby="attempt-heading"><h4 id="attempt-heading">試行履歴</h4>{selected.attempts.length ? <ol>{selected.attempts.map((attempt) => <li key={`${selected.id}-${attempt.number}`}><strong>Attempt {attempt.number}</strong><span>{attempt.result}</span><time>{attempt.at}</time></li>)}</ol> : <p>まだ試行されていません。</p>}</section>
          <div className={styles.actionRow}><button className={styles.primaryButton} disabled={!retryable} type="button" onClick={() => setConfirmation("retry")}>再試行</button><button className={styles.dangerGhostButton} disabled={!cancellable} type="button" onClick={() => setConfirmation("cancel")}>取消</button></div>
        </article>
      </div>
      <DangerConfirmation open={confirmation !== null} title={confirmation === "retry" ? "ジョブを再試行" : "ジョブを取消"} description={`${selected.id}は現在${selected.status}です。現在のattemptと重複防止を確認して受付します。`} confirmLabel={confirmation === "retry" ? "再試行を受付" : "取消を受付"} tone={confirmation === "retry" ? "standard" : "danger"} onCancel={() => setConfirmation(null)} onConfirm={confirmJobAction} />
    </section>
  );
}

function ContentsExperience() {
  const [selectedKind, setSelectedKind] = useState<ContentKind>("talk");
  const initial = demoContents.find((content) => content.kind === selectedKind) ?? demoContents[0];
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [version, setVersion] = useState(initial.version);
  const [feedback, setFeedback] = useState("");

  function chooseKind(kind: ContentKind) {
    const content = demoContents.find((item) => item.kind === kind) ?? demoContents[0];
    setSelectedKind(kind);
    setTitle(content.title);
    setBody(content.body);
    setVersion(content.version);
    setFeedback("");
  }

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVersion((current) => current + 1);
    setFeedback(`${selectedKind}の新しい下書き版を保存しました。公開版は変更していません。`);
  }

  const selected = demoContents.find((content) => content.kind === selectedKind) ?? demoContents[0];
  return (
    <section className={styles.experience} aria-label="コンテンツ管理">
      <div aria-label="コンテンツ種別" className={styles.segmented} role="tablist">
        {contentKinds.map((kind) => {
          const content = demoContents.find((item) => item.kind === kind) ?? demoContents[0];
          return <button aria-selected={selectedKind === kind} key={kind} role="tab" type="button" onClick={() => chooseKind(kind)}>{content.label}</button>;
        })}
      </div>
      <Feedback message={feedback} />
      <div className={styles.editorGrid}>
        <form className={styles.editorPanel} onSubmit={saveDraft}>
          <div className={styles.detailHeading}><div><p>{selected.label}</p><h3>編集</h3></div><span className={styles.stateBadge} data-state="draft">v{version} draft</span></div>
          <label className={styles.field}>タイトル<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className={styles.field}>本文<textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <label className={styles.field}>変更理由<input defaultValue="説明文を更新" /></label>
          <button className={styles.primaryButton} type="submit">下書きを保存</button>
        </form>
        <article className={styles.previewPanel} aria-live="polite">
          <div className={styles.detailHeading}><div><p>利用者表示</p><h3>プレビュー</h3></div></div>
          <div className={styles.previewContent}><p>{selected.source}</p><h4>{title || "タイトル未入力"}</h4><p>{body || "本文を入力するとここに表示されます。"}</p></div>
          <section className={styles.versionList}><h4>版履歴</h4><ol><li><strong>v{version}</strong><span>編集中の下書き</span></li><li><strong>v{selected.version}</strong><span>{selected.state === "published" ? "現在の公開版" : "前の下書き"}</span></li><li><strong>v{Math.max(1, selected.version - 1)}</strong><span>変更前</span></li></ol></section>
        </article>
      </div>
      <aside className={styles.note}><strong>公開前の確認</strong><span>表示内容と版を確認してから公開してください。</span></aside>
    </section>
  );
}

function RetentionExperience() {
  const [requests, setRequests] = useState(demoDeletionRequests);
  const [selectedId, setSelectedId] = useState(demoDeletionRequests[0].id);
  const [confirmation, setConfirmation] = useState<"delete" | "hold" | "release" | null>(null);
  const [feedback, setFeedback] = useState("");
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0];

  function confirmRetentionAction() {
    if (confirmation === "delete") {
      setFeedback(`${selected.id}の削除を開始しました。完了確認前は成功扱いにしません。`);
    }
    if (confirmation === "hold") {
      setRequests((current) => current.map((request) => request.id === selected.id ? { ...request, hold: true, state: "held" } : request));
      setFeedback(`${selected.id}にLegal Holdを設定しました。`);
    }
    if (confirmation === "release") {
      setRequests((current) => current.map((request) => request.id === selected.id ? { ...request, hold: false, state: "pending" } : request));
      setFeedback(`${selected.id}のLegal Holdを解除しました。削除は自動開始しません。`);
    }
    setConfirmation(null);
  }

  const isDelete = confirmation === "delete";
  return (
    <section className={styles.experience} aria-label="保存期間と削除">
      <div className={styles.policyGrid} aria-label="保存方針の初期案"><article><span>PDF・音声</span><strong>90日</strong><small>初期案</small></article><article><span>文字起こし・振り返り</span><strong>180日</strong><small>初期案</small></article><article><span>監査ログ</span><strong>1年</strong><small>本文なし</small></article></div>
      <Feedback message={feedback} />
      <div className={styles.masterDetail}>
        <div className={styles.listPanel}><h3>削除要求</h3><ul className={styles.selectionList}>{requests.map((request) => <li key={request.id}><button aria-pressed={selected.id === request.id} type="button" onClick={() => setSelectedId(request.id)}><strong>{request.id}</strong><span>{request.target}・{request.count}件</span><small data-state={request.state}>{request.state}</small></button></li>)}</ul></div>
        <article className={styles.detailPanel}>
          <div className={styles.detailHeading}><div><p>削除要求</p><h3>{selected.id}</h3></div><span className={styles.stateBadge} data-state={selected.state}>{selected.state}</span></div>
          <dl className={styles.definitionList}><div><dt>対象</dt><dd>{selected.target}</dd></div><div><dt>件数</dt><dd>{selected.count}件</dd></div><div><dt>Legal Hold</dt><dd>{selected.hold ? "設定中・削除停止" : "なし"}</dd></div><div><dt>取消可能</dt><dd>ジョブ開始前まで</dd></div></dl>
          <ol className={styles.steps}><li><strong>1</strong><span>対象確認</span></li><li><strong>2</strong><span>権限者承認</span></li><li><strong>3</strong><span>順序付き削除</span></li><li><strong>4</strong><span>残存確認</span></li></ol>
          <div className={styles.actionRow}>{selected.hold ? <button className={styles.secondaryButton} type="button" onClick={() => setConfirmation("release")}>Legal Holdを解除</button> : <button className={styles.secondaryButton} type="button" onClick={() => setConfirmation("hold")}>Legal Holdを設定</button>}<button className={styles.dangerButton} disabled={selected.hold} type="button" onClick={() => setConfirmation("delete")}>削除を開始</button></div>
        </article>
      </div>
      <DangerConfirmation open={confirmation !== null} title={isDelete ? "削除開始の最終確認" : confirmation === "hold" ? "Legal Holdを設定" : "Legal Holdを解除"} description={isDelete ? `${selected.id}の${selected.count}件を順序付きで削除します。削除後は本文を復元できません。` : `${selected.id}の削除停止状態を変更します。理由と判断は監査対象です。`} confirmLabel={isDelete ? "削除を開始" : confirmation === "hold" ? "Holdを設定" : "Holdを解除"} requiredPhrase={isDelete ? "削除を開始" : undefined} tone="danger" onCancel={() => setConfirmation(null)} onConfirm={confirmRetentionAction} />
    </section>
  );
}

function AuditExperience() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(demoAuditEvents[0].id);
  const [feedback, setFeedback] = useState("");
  const visible = demoAuditEvents.filter((event) => `${event.action} ${event.result} ${event.requestId} ${event.resource}`.toLowerCase().includes(query.toLowerCase()));
  const selected = demoAuditEvents.find((event) => event.id === selectedId) ?? demoAuditEvents[0];

  async function copyRequestId() {
    try {
      await navigator.clipboard?.writeText(selected.requestId);
    } finally {
      setFeedback(`${selected.requestId}をコピーしました。`);
    }
  }

  return (
    <section className={styles.experience} aria-label="監査ログと障害確認">
      <div className={styles.toolbar}><label className={styles.searchField}>action・result・request IDを検索<input value={query} type="search" onChange={(event) => setQuery(event.target.value)} /></label><button className={styles.secondaryButton} type="button" onClick={() => setQuery("")}>条件を解除</button></div>
      <Feedback message={feedback} />
      <div className={styles.masterDetail}>
        <div className={styles.listPanel}><div className={styles.panelTitle}><h3>監査イベント</h3><span>{visible.length}件</span></div>{visible.length ? <ol className={styles.selectionList}>{visible.map((event) => <li key={event.id}><button aria-pressed={selected.id === event.id} type="button" onClick={() => setSelectedId(event.id)}><strong>{event.at}・{event.action}</strong><span>{event.resource}</span><small data-state={event.result}>{event.result}</small></button></li>)}</ol> : <p className={styles.empty}>条件に一致する監査イベントはありません。</p>}</div>
        <article className={styles.detailPanel}>
          <div className={styles.detailHeading}><div><p>イベント詳細</p><h3>{selected.action}</h3></div><span className={styles.stateBadge} data-state={selected.result}>{selected.result}</span></div>
          <dl className={styles.definitionList}><div><dt>時刻</dt><dd><time>{selected.at}</time></dd></div><div><dt>actor</dt><dd>{selected.actor}</dd></div><div><dt>resource</dt><dd><code>{selected.resource}</code></dd></div><div><dt>request ID</dt><dd><code>{selected.requestId}</code></dd></div><div><dt>job ID</dt><dd>{selected.jobId ? <code>{selected.jobId}</code> : "なし"}</dd></div></dl>
          <button className={styles.primaryButton} type="button" onClick={copyRequestId}>request IDをコピー</button>
        </article>
      </div>
    </section>
  );
}

function ApprovalExperience() {
  const [checked, setChecked] = useState<boolean[]>(approvalFixture.criteria.map(() => false));
  const [comment, setComment] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const allChecked = checked.every(Boolean);

  function returnForChanges() {
    if (!comment.trim()) {
      setFeedback("差し戻し理由を入力してください。");
      return;
    }
    setFeedback(`${approvalFixture.version}を差し戻しました。公開版は変更していません。`);
  }

  return (
    <section className={styles.experience} aria-label="コンテンツ承認">
      <Feedback message={feedback} tone={feedback.includes("入力") ? "warning" : "success"} />
      <div className={styles.approvalGrid}>
        <article className={styles.diffPanel}>
          <div className={styles.detailHeading}><div><p>{approvalFixture.previousVersion} → {approvalFixture.version}</p><h3>{approvalFixture.item}</h3></div><span>対象版</span></div>
          <ul className={styles.diffList}>{approvalFixture.changes.map((change) => <li data-change={change.type} key={change.type}><strong>{change.type}</strong><span>{change.text}</span></li>)}</ul>
        </article>
        <form className={styles.checklistPanel} onSubmit={(event) => { event.preventDefault(); setConfirmationOpen(true); }}>
          <fieldset><legend>承認基準</legend>{approvalFixture.criteria.map((criterion, index) => <label key={criterion}><input checked={checked[index]} type="checkbox" onChange={(event) => setChecked((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))} /><span>{criterion}</span></label>)}</fieldset>
          <label className={styles.field}>判断コメント<textarea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="差し戻す場合は必須" /></label>
          <div className={styles.actionRow}><button className={styles.secondaryButton} type="button" onClick={returnForChanges}>差し戻す</button><button className={styles.primaryButton} disabled={!allChecked} type="submit">この版を承認</button></div>
        </form>
      </div>
      <DangerConfirmation open={confirmationOpen} title={`${approvalFixture.version}を承認`} description="チェック済みの基準版に対する判断として記録します。公開は別の権限と操作が必要です。" confirmLabel="承認を記録" tone="standard" onCancel={() => setConfirmationOpen(false)} onConfirm={() => { setFeedback(`${approvalFixture.version}の承認を記録しました。自動公開はしていません。`); setConfirmationOpen(false); }} />
    </section>
  );
}

function AnalyticsExperience() {
  const [period, setPeriod] = useState<"今月" | "前月">("今月");
  const [tableOpen, setTableOpen] = useState(true);
  return (
    <section className={styles.experience} aria-label="チーム分析">
      <div className={styles.toolbar}><div aria-label="集計期間" className={styles.periodSwitch}>{(["今月", "前月"] as const).map((item) => <button aria-pressed={period === item} key={item} type="button" onClick={() => setPeriod(item)}>{item}</button>)}</div><button className={styles.secondaryButton} type="button" onClick={() => setTableOpen((value) => !value)}>{tableOpen ? "表を閉じる" : "表で確認"}</button></div>
      <div className={styles.analyticsMeta}><span>対象期間 <strong>{period}</strong></span><span>集団 <strong>3店舗・38件</strong></span><span>最小集団 <strong>10件</strong></span></div>
      <div className={styles.analyticsGrid}>
        <figure className={styles.chart} aria-labelledby="team-trend-caption">
          <figcaption id="team-trend-caption"><strong>説明品質の集約</strong><span>母数38件・個人別表示なし</span></figcaption>
          <div className={styles.bars} aria-hidden="true">{analyticsFixture.map((metric) => <div key={metric.label}><span style={{ height: `${metric.value}%` }} /><strong>{metric.value}%</strong><small>{metric.label}</small></div>)}</div>
        </figure>
        <article className={styles.summaryPanel}><h3>読み取り</h3><p>「金額根拠の提示」は他の集約項目より低く、次回の教材改善候補です。</p><p>個人名、順位、人事評価情報は集計していません。</p></article>
      </div>
      {tableOpen ? <div className={styles.tableWrap}><table><caption>グラフと同じ集約値</caption><thead><tr><th scope="col">項目</th><th scope="col">割合</th><th scope="col">母数</th></tr></thead><tbody>{analyticsFixture.map((metric) => <tr key={metric.label}><th scope="row">{metric.label}</th><td>{metric.value}%</td><td>{metric.total}件</td></tr>)}</tbody></table></div> : null}
      <aside className={styles.note}><strong>小集団保護</strong><span>10件未満は0として表示せず「集団が小さいため非表示」とします。</span></aside>
    </section>
  );
}

export function LaneCExperience({ kind }: { kind: ScreenKind }): ReactNode {
  switch (kind) {
    case "users": return <UsersExperience />;
    case "jobs": return <JobsExperience />;
    case "contents": return <ContentsExperience />;
    case "retention": return <RetentionExperience />;
    case "audit": return <AuditExperience />;
    case "approval": return <ApprovalExperience />;
    case "analytics": return <AnalyticsExperience />;
    default: return null;
  }
}
