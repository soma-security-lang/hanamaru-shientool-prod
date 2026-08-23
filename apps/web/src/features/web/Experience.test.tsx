import {cleanup,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ApiClientError} from "@/lib/api/client";
import {resources,type ApprovalBatchDto,type TranscriptQualityAssessmentDto,type VisitWorkspaceDto} from "@/lib/api/resources";
import {approvalBody,WebExperience} from "./Experience";

vi.mock("next/navigation",()=>({usePathname:()=>"/admin/approvals",useRouter:()=>({push:vi.fn(),replace:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
const contentRepository=vi.hoisted(()=>({search:vi.fn(),get:vi.fn(),counts:vi.fn(),related:vi.fn()}));
vi.mock("@/lib/content/repository",()=>({getContentRepository:async()=>contentRepository}));

function approval(selfSubmitted:boolean):ApprovalBatchDto{return{id:"approval-1",type:"manual",category:"接客手順",status:"in_review",itemCount:1,requiredApprovals:1,approvalCount:0,snapshotHash:"a".repeat(64),submittedAt:"2026-08-13T00:00:00Z",decidedAt:null,selfSubmitted,items:[{id:"content-1",versionId:"version-2",version:2,sourceHash:"b".repeat(64),title:"接客手順"}],decisions:[]};}
function quality(overrides:Partial<TranscriptQualityAssessmentDto>={}):TranscriptQualityAssessmentDto{return{id:"quality-1",transcriptId:"transcript-1",status:"evaluated",flags:[],confidence:.98,evidenceSegmentIds:[],continuationDecision:null,acknowledgedAt:null,lockVersion:1,metrics:{segmentCount:3,chunkCount:2,maxLabelsPerChunk:1,speechOccupancyRatio:.74},...overrides};}
function workspace(assessment:TranscriptQualityAssessmentDto|null=quality()):VisitWorkspaceDto{return{visit:{id:"visit-1",caseNumber:"HV-1",branchId:"branch-1",branchName:"中央店",status:"visited",visitDate:null,visitTime:null,timeZone:"Asia/Tokyo",scheduledAt:null,customerLabel:null,lockVersion:1},document:null,extraction:null,fields:[],recording:null,transcript:{id:"transcript-1",status:"confirmed",lockVersion:3,fullText:"査定員: ご説明します\nお客様: お願いします"},qualityAssessment:assessment,segments:[{id:"segment-1",sequenceNo:0,startMs:0,endMs:1000,speakerLabel:"chunk-0:1",speakerRole:"unknown",text:"ご説明します",editedText:null,confidence:.9},{id:"segment-2",sequenceNo:1,startMs:1000,endMs:2000,speakerLabel:"chunk-0:1",speakerRole:"unknown",text:"続けます",editedText:null,confidence:.9},{id:"segment-3",sequenceNo:2,startMs:600_000,endMs:601_000,speakerLabel:"chunk-1:1",speakerRole:"unknown",text:"お願いします",editedText:null,confidence:.9}],review:null,findings:[],consent:null,jobs:[]};}

afterEach(()=>{cleanup();vi.restoreAllMocks();contentRepository.search.mockReset();contentRepository.get.mockReset();contentRepository.counts.mockReset();contentRepository.related.mockReset();});

describe("training video draft preview",()=>{
  it("loads an authenticated editor preview without publishing the draft",async()=>{
    const user=userEvent.setup();
    const summary={id:"video-draft-1",legacyId:"video-draft-1",type:"video",category:"基本",title:"匿名下書き動画",tags:[],publicationState:"draft",availabilityState:"restricted"};
    contentRepository.search.mockResolvedValue({items:[summary],total:1});
    contentRepository.get.mockResolvedValue({...summary,version:1,body:"匿名の文字版",legacyPayload:{},sourceRef:{repository:"database",file:"content_versions",variable:null,captured_at:"",source_sha256:"a".repeat(64)},originalHash:"a".repeat(64),migrationState:"not_applicable",reviewReason:""});
    const access=vi.spyOn(resources,"trainingVideoAccess").mockResolvedValue({url:"https://storage.example.invalid/signed-draft",expiresAt:"2026-08-13T12:00:00Z",requiresBearer:false});
    render(<WebExperience kind="contentsAdmin"/>);
    await user.selectOptions(screen.getByLabelText("コンテンツ種別"),"video");
    expect(await screen.findByLabelText("下書き動画プレビュー")).toHaveAttribute("src","https://storage.example.invalid/signed-draft");
    expect(access).toHaveBeenCalledWith("video-draft-1");
  });
});

describe("content approval exact-version rendering",()=>{
  it("renders every field from the actual version body without inventing a diff",()=>{
    const body={body:"変更後の本文",tags:["法令","接客"],legacyPayload:{point:"急がせない"}};
    expect(approvalBody(body)).toBe(JSON.stringify(body,null,2));
    expect(approvalBody(body)).toContain('"急がせない"');
  });

  it("states explicitly when an initial version has no predecessor",()=>{
    expect(approvalBody(null)).toBe("（初版のため比較対象なし）");
  });

  it("does not expose batch wording from an API-provided category",async()=>{
    vi.spyOn(resources,"approvalBatches").mockResolvedValue({items:[{...approval(false),category:"承認batch"}],candidates:[],hasMore:false,nextCursor:null});
    render(<WebExperience kind="approval"/>);
    expect((await screen.findAllByRole("heading",{name:"承認対象セット"})).length).toBeGreaterThan(0);
    expect(screen.queryByText("承認batch")).not.toBeInTheDocument();
  });

  it("identifies a self-submitted batch and blocks every decision",async()=>{
    vi.spyOn(resources,"approvalBatches").mockResolvedValue({items:[approval(true)],candidates:[],hasMore:false,nextCursor:null});
    render(<WebExperience kind="approval"/>);
    expect(await screen.findByText(/提出者本人は判断できません/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"承認対象セットを承認"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"承認対象セットを差し戻す"})).toBeDisabled();
  });

  it("turns a 403 approval separation response into an actionable recovery message",async()=>{
    const user=userEvent.setup();
    vi.spyOn(resources,"approvalBatches").mockResolvedValue({items:[approval(false)],candidates:[],hasMore:false,nextCursor:null});
    vi.spyOn(resources,"decideApprovalBatch").mockRejectedValue(new ApiClientError(403,"SELF_APPROVAL_FORBIDDEN","forbidden"));
    render(<WebExperience kind="approval"/>);
    for(const checkbox of await screen.findAllByRole("checkbox"))await user.click(checkbox);
    await user.type(screen.getByRole("textbox",{name:"判断理由"}),"原文と基準を確認しました");
    await user.click(screen.getByRole("button",{name:"承認対象セットを承認"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("別の承認担当者へ依頼してください");
    expect(screen.getByRole("button",{name:"最新状態を再読み込み"})).toBeEnabled();
  });
});

describe("Japanese operational vocabulary",()=>{
  it("renders job type, target, and state without raw enums in the main view",async()=>{
    const job={id:"job-1",jobType:"transcribe",status:"retry_wait",entityType:"recording",entityId:"recording-1",attemptCount:1,maxAttempts:3,errorCode:"PROVIDER_TEMPORARY",createdAt:"2026-08-13T00:00:00Z",finishedAt:null,attempts:[]};
    vi.spyOn(resources,"jobs").mockResolvedValue({items:[job],hasMore:false,nextCursor:null});
    vi.spyOn(resources,"job").mockResolvedValue(job);
    render(<WebExperience kind="operations" capabilities={["job:manage"]}/>);
    expect(await screen.findByRole("button",{name:"文字起こし"})).toBeInTheDocument();
    expect(screen.getByText("録音")).toBeInTheDocument();
    expect(screen.getAllByText("再試行待ち").length).toBeGreaterThan(0);
    expect(screen.queryByText("transcribe")).not.toBeInTheDocument();
    expect(screen.queryByText("retry_wait")).not.toBeInTheDocument();
  });

  it("renders membership state in Japanese",async()=>{
    vi.spyOn(resources,"users").mockResolvedValue({items:[{id:"member-1",branchId:"branch-1",status:"active",lockVersion:1,displayName:"匿名利用者",emailMasked:"u***@example.invalid",roles:["assessor"]}],hasMore:false,nextCursor:null});
    render(<WebExperience kind="usersAdmin" viewerId="viewer-1"/>);
    expect(await screen.findByText("利用中")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });
});

describe("user role separation",()=>{
  const self={id:"member-self",branchId:"branch-1",status:"active",lockVersion:1,displayName:"現在の管理者",emailMasked:"m***@example.invalid",roles:["manager"]};
  const systemAdmin={id:"member-system",branchId:"branch-1",status:"active",lockVersion:2,displayName:"システム管理者",emailMasked:"s***@example.invalid",roles:["system_admin","manager"]};

  it("does not allow the signed-in user to change or suspend their own access",async()=>{
    const replace=vi.spyOn(resources,"replaceRoles").mockResolvedValue({});
    const update=vi.spyOn(resources,"updateUser").mockResolvedValue(self);
    vi.spyOn(resources,"users").mockResolvedValue({items:[self],hasMore:false,nextCursor:null});
    render(<WebExperience kind="usersAdmin" viewerId={self.id}/>);
    expect(await screen.findByText("自分自身の権限と利用状態は、この画面から変更できません。")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"変更内容を確認"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"利用を停止"})).toBeDisabled();
    expect(screen.getByRole("checkbox",{name:"管理者"})).toBeDisabled();
    expect(replace).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps system-admin provisioning outside the role editor and invitation form",async()=>{
    const user=userEvent.setup();
    const replace=vi.spyOn(resources,"replaceRoles").mockResolvedValue({});
    vi.spyOn(resources,"users").mockResolvedValue({items:[systemAdmin],hasMore:false,nextCursor:null});
    render(<WebExperience kind="usersAdmin" viewerId={self.id}/>);
    expect(await screen.findByText(/システム管理者は管理専用アカウントです/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"変更内容を確認"})).toBeDisabled();
    expect(screen.getByRole("checkbox",{name:"管理者"})).toBeDisabled();
    await user.click(screen.getByRole("button",{name:"利用者を招待"}));
    const roleSelect=screen.getByLabelText("最初の業務権限");
    expect(within(roleSelect).queryByRole("option",{name:"システム管理者"})).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("operations capability boundaries",()=>{
  it("shows only manager-authorized operations tabs",()=>{
    vi.spyOn(resources,"jobs").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
    render(<WebExperience kind="operations" capabilities={["job:manage","retention:manage"]}/>);
    expect(screen.getByRole("button",{name:"ジョブ"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"AI機能"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"保存・削除"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"監査ログ"})).not.toBeInTheDocument();
  });

  it("shows audit but not retention to a system administrator",()=>{
    vi.spyOn(resources,"jobs").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
    render(<WebExperience kind="operations" capabilities={["job:manage","audit:read"]}/>);
    expect(screen.getByRole("button",{name:"監査ログ"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"保存・削除"})).not.toBeInTheDocument();
  });
});

describe("speaker label and transcript quality safeguards",()=>{
  it("keeps speaker assignment on individual utterances without a bulk chunk control",async()=>{
    const user=userEvent.setup();
    vi.spyOn(resources,"workspace").mockResolvedValue(workspace());
    render(<WebExperience kind="transcription"/>);
    expect(await screen.findByLabelText("発話 1 の役割")).toHaveValue("unknown");
    expect(screen.queryByText("話者をチャンク単位で割り当て")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/一括割当/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("発話 1 の役割"),"staff");
    expect(screen.getByLabelText("発話 1 の役割")).toHaveValue("staff");
    expect(screen.getByLabelText("発話 2 の役割")).toHaveValue("unknown");
    expect(screen.getByLabelText("発話 3 の役割")).toHaveValue("unknown");
  });

  it("records an explicit continue decision for risky audio",async()=>{
    const user=userEvent.setup();
    const risky=quality({flags:["possible_media"],evidenceSegmentIds:["segment-2"]});
    const acknowledged={...risky,continuationDecision:"continue" as const,acknowledgedAt:"2026-08-21T01:00:00Z",lockVersion:2};
    vi.spyOn(resources,"workspace").mockResolvedValueOnce(workspace(risky)).mockResolvedValue(workspace(acknowledged));
    const acknowledge=vi.spyOn(resources,"acknowledgeTranscriptQuality").mockResolvedValue(acknowledged);
    render(<WebExperience kind="transcription"/>);
    expect(await screen.findByText("放送・動画などの音声が含まれる可能性があります")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"内容を確認して利用継続"}));
    expect(acknowledge).toHaveBeenCalledWith("transcript-1","continue",1);
    expect(await screen.findByText(/利用継続する判断を記録済み/)).toBeInTheDocument();
  });

  it("blocks review generation until a risky transcript is acknowledged",async()=>{
    vi.spyOn(resources,"workspace").mockResolvedValue(workspace(quality({flags:["many_speakers"]})));
    const request=vi.spyOn(resources,"requestReview").mockResolvedValue({jobId:"job-1"});
    render(<WebExperience kind="reviewInput"/>);
    expect(await screen.findByText("音声品質の確認が必要です")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/AI振り返りを作成/})).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  it("lets the user choose review dimensions and sends only those selections",async()=>{
    const user=userEvent.setup();
    vi.spyOn(resources,"workspace").mockResolvedValue(workspace());
    const request=vi.spyOn(resources,"requestReview").mockResolvedValue({jobId:"job-1"});
    render(<WebExperience kind="reviewInput"/>);
    for(const label of ["改善できる点","利用できたトーク","法令・コンプライアンス","次回の助言","再訪可能性"]){await user.click(await screen.findByRole("checkbox",{name:label}));}
    expect(screen.getByRole("checkbox",{name:"接客の良かった点"})).toBeChecked();
    await user.click(screen.getByRole("button",{name:/AI振り返りを作成/}));
    expect(request).toHaveBeenCalledWith("transcript-1",["strength"]);
  });

  it("requires at least one review dimension",async()=>{
    const user=userEvent.setup();
    vi.spyOn(resources,"workspace").mockResolvedValue(workspace());
    render(<WebExperience kind="reviewInput"/>);
    for(const checkbox of await screen.findAllByRole("checkbox"))await user.click(checkbox);
    expect(screen.getByRole("alert")).toHaveTextContent("1項目以上");
    expect(screen.getByRole("button",{name:/AI振り返りを作成/})).toBeDisabled();
  });
});

describe("operations visibility",()=>{
  it("shows aggregate health without exposing transcript content",async()=>{
    vi.spyOn(resources,"jobs").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
    vi.spyOn(resources,"operationsHealth").mockResolvedValue({status:"critical",counts:{warning:1,critical:1},alerts:[{id:"alert-1",failureClass:"EVIDENCE_INVALID",jobType:"review",attempt:2,maxAttempts:3,oldestAgeSeconds:80,jobId:"job-1",severity:"critical",detectedAt:"2026-08-21T01:00:00Z"}],scannedAt:"2026-08-21T01:01:00Z"});
    render(<WebExperience kind="operations" capabilities={["job:manage"]}/>);
    expect(await screen.findByText("重大な異常あり")).toBeInTheDocument();
    expect(screen.getByText("振り返り根拠の不整合")).toBeInTheDocument();
    expect(screen.queryByText("実際の文字起こし本文")).not.toBeInTheDocument();
  });

  it("shows the immutable retention binding applied to a selected visit",async()=>{
    const user=userEvent.setup();
    vi.spyOn(resources,"retentionPolicies").mockResolvedValue({policies:[],deletionSummary:[]});
    vi.spyOn(resources,"deletions").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
    vi.spyOn(resources,"visits").mockResolvedValue({items:[workspace().visit],hasMore:false,nextCursor:null});
    vi.spyOn(resources,"retentionBindings").mockResolvedValue({items:[{resourceType:"recording",resourceId:"recording-1",status:"available",policyId:"policy-1",policyVersion:2,retentionDays:90,retentionUntil:"2026-11-19T00:00:00Z",legalHoldActive:false}]});
    render(<WebExperience kind="operations" capabilities={["retention:manage"]}/>);
    await user.selectOptions(await screen.findByLabelText("保存期限を確認する案件"),"visit-1");
    expect(await screen.findByText("90日")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(resources.retentionBindings).toHaveBeenCalledWith("visit-1");
  });
});

describe("pilot content AI disclosure",()=>{
  it("shows an unapproved-content review warning on every AI-assisted screen when the organization gate is enabled",()=>{
    vi.spyOn(resources,"dashboard").mockResolvedValue({visits:[],jobs:[]});
    vi.spyOn(resources,"workspace").mockResolvedValue({visit:{id:"visit-1",caseNumber:"HV-1",branchId:"branch-1",branchName:"中央店",status:"ready",visitDate:null,visitTime:null,timeZone:"Asia/Tokyo",scheduledAt:null,customerLabel:null,lockVersion:1},document:null,extraction:null,fields:[],recording:null,transcript:null,qualityAssessment:null,segments:[],review:null,findings:[],consent:null,jobs:[]});
    vi.spyOn(resources,"preparation").mockResolvedValue(null);
    vi.spyOn(resources,"roleplaySessions").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
    for(const kind of ["aiHome","visitPreparation","roleplay"] as const){
      render(<WebExperience kind={kind} featureFlags={{pilot_content_ai:true}}/>);
      expect(screen.getByText("未承認コンテンツ使用・要確認")).toBeInTheDocument();
      expect(screen.getByText(/原文と照合して判断してください/)).toBeInTheDocument();
      cleanup();
    }
  });
});
