import type {ContentType} from "@/lib/content/types";

export type DisplayTone = "neutral" | "info" | "success" | "warning" | "danger";
export interface DisplayLabel {label:string;description?:string;tone:DisplayTone;nextAction?:string;}

const unknown=(namespace:string):DisplayLabel=>({label:"未定義の状態",description:`${namespace}の表示定義を確認してください。`,tone:"warning",nextAction:"技術詳細を確認して管理者へ連絡してください"});
const pick=(values:Record<string,DisplayLabel>,value:string,namespace:string)=>values[value]??unknown(namespace);
const item=(label:string,description:string,tone:DisplayTone="neutral",nextAction?:string):DisplayLabel=>({label,description,tone,...(nextAction?{nextAction}:{})});

const contentTypes:Record<string,DisplayLabel>={
  talk:item("切り返しトーク集","接客時の伝え方"),flow:item("困ったときのフロー集","状況別の対応手順"),
  glossary:item("用語集","査定・接客用語"),price:item("金券買取価格表","金券の買取価格"),
  manual:item("接客マニュアル","接客の標準手順"),legal:item("法務・コンプライアンス","法令と遵守事項"),
  video:item("動画ライブラリ","研修動画"),roleplay:item("AIロープレ","対話形式の接客練習"),
};
const publicationStates:Record<string,DisplayLabel>={
  draft:item("下書き","現場には正式公開されていません","neutral"),pilot:item("限定利用中","正式承認前のため原文確認が必要です","warning"),
  published:item("公開中","現場で利用できます","success"),archived:item("公開終了","現在は現場に表示されません","neutral"),
};
const approvalStates:Record<string,DisplayLabel>={
  draft:item("下書き","承認への提出前です"),in_review:item("確認中","承認担当者の判断を待っています","info"),
  approved:item("承認済み","公開条件を満たしました","success"),rejected:item("差戻し","修正して再提出してください","danger","内容を修正して再提出してください"),
  invalidated:item("再確認が必要","対象版が変更されました","warning","最新の対象で承認セットを作り直してください"),
};
const jobTypes:Record<string,DisplayLabel>={
  pdf_extract:item("PDF情報抽出","訪問情報をPDFから読み取ります"),preparation:item("訪問前チェック生成","訪問前の確認事項を作成します"),
  transcribe:item("文字起こし","録音を文字に変換します"),review:item("AI振り返り生成","会話から振り返りを作成します"),
  drive_import:item("Google Drive音声取込","選択した録音を取り込みます"),retention_scan:item("保存期限確認","保存期限を迎えたデータを確認します"),
  deletion:item("削除処理","承認済みの削除要求を処理します"),content_import:item("コンテンツ取込","既存コンテンツを取り込みます"),
};
const jobStates:Record<string,DisplayLabel>={
  queued:item("受付済み","処理開始を待っています","info"),running:item("処理中","ページを閉じても処理は続きます","info"),
  retry_wait:item("再試行待ち","一時的な問題のため自動で再試行します","warning","時間をおいて状態を確認してください"),
  succeeded:item("完了","結果を確認できます","success"),failed:item("要対応","再試行または管理者確認が必要です","danger","再試行するか技術詳細を確認してください"),
  cancelled:item("取消済み","処理は実行されません","neutral"),starting:item("開始準備中","外部処理の受付を準備しています","info"),
};
const entityTypes:Record<string,DisplayLabel>={
  visit:item("訪問案件","訪問単位の処理"),document:item("訪問情報PDF","アップロードされたPDF"),recording:item("録音","訪問時の音声"),
  transcript:item("文字起こし","音声から作成した会話記録"),review:item("振り返り","AIが作成した振り返り"),content:item("コンテンツ","現場知識または研修内容"),
  deletion_request:item("削除要求","案件データの削除依頼"),organization:item("組織","組織共通の処理"),
};
const membershipStates:Record<string,DisplayLabel>={
  active:item("利用中","ログインできます","success"),invited:item("招待済み","初回ログインを待っています","info"),
  suspended:item("利用停止","ログインできません","danger"),deleted:item("削除済み","利用できません","neutral"),
};
const visitStates:Record<string,DisplayLabel>={
  draft:item("登録準備中","PDFの情報を確認してください"),ready:item("訪問準備中","訪問前チェックを確認してください","info"),
  visited:item("訪問完了","録音と文字起こしを確認してください","info"),reviewed:item("振り返り済み","振り返り結果を確認できます","success"),
  closed:item("完了","一連の対応が完了しました","success"),deleted:item("削除済み","案件は利用できません","neutral"),
};
const deletionStates:Record<string,DisplayLabel>={
  requested:item("受付済み","削除処理の開始を待っています","info"),queued:item("削除待ち","削除処理を待っています","info"),
  running:item("削除中","対象データを削除しています","warning"),held:item("保持停止中","調査等のため削除を停止しています","warning"),
  completed:item("削除完了","対象データを削除しました","success"),failed:item("要対応","削除処理を完了できませんでした","danger","技術詳細を確認してください"),
  cancelled:item("取消済み","削除は実行されません","neutral"),
};
const auditResults:Record<string,DisplayLabel>={
  success:item("成功","操作を記録しました","success"),succeeded:item("成功","操作を記録しました","success"),
  denied:item("拒否","権限または条件を満たさないため実行しませんでした","danger"),failure:item("失敗","操作を完了できませんでした","danger"),failed:item("失敗","操作を完了できませんでした","danger"),
};
const attemptResults:Record<string,DisplayLabel>={...jobStates,permanent_failure:item("再試行不可","管理者による確認が必要です","danger"),temporary_failure:item("一時失敗","自動で再試行します","warning")};
const artifactStates:Record<string,DisplayLabel>={
  uploaded:item("取込済み","ファイルを受け付けました","info"),processing:item("処理中","結果を作成しています","info"),generated:item("生成済み","内容を確認してください","info"),
  confirmed:item("確認済み","人による確認が完了しました","success"),acknowledged:item("確認済み","結果の確認が完了しました","success"),
  pending:item("確認待ち","確認または処理を待っています","warning"),available:item("利用可能","内容を確認できます","success"),
};
const auditActions:Record<string,DisplayLabel>={
  "visit.create":item("訪問を登録","訪問案件を登録しました"),"visit.update":item("訪問情報を更新","訪問案件の情報を更新しました"),
  "job.retry":item("処理を再試行","失敗または待機中の処理を再試行しました"),"job.cancel":item("処理を取消","処理の取消を要求しました"),
  "content.create":item("コンテンツを作成","新しい下書きを作成しました"),"content.update":item("コンテンツを更新","コンテンツの新しい版を作成しました"),
  "content.publish":item("コンテンツを公開","承認済みの版を公開しました"),"user.invite":item("利用者を招待","利用者の招待を登録しました"),
  "user.update":item("利用者情報を更新","利用状態を変更しました"),"roles.replace":item("利用者権限を変更","業務権限を変更しました"),
  "deletion.request":item("削除を要求","案件データの削除を要求しました"),"legal_hold.create":item("保持停止を設定","削除の保持停止を設定しました"),
  "legal_hold.release":item("保持停止を解除","削除の保持停止を解除しました"),
};

export const contentTypeLabel=(value:ContentType|string)=>pick(contentTypes,value,"コンテンツ種別");
export const publicationStateLabel=(value:string)=>pick(publicationStates,value,"公開状態");
export const approvalStateLabel=(value:string)=>pick(approvalStates,value,"承認状態");
export const jobTypeLabel=(value:string)=>pick(jobTypes,value,"処理種別");
export const jobStateLabel=(value:string)=>pick(jobStates,value,"処理状態");
export const entityTypeLabel=(value:string)=>pick(entityTypes,value,"対象種別");
export const membershipStateLabel=(value:string)=>pick(membershipStates,value,"利用状態");
export const visitStateLabel=(value:string)=>pick(visitStates,value,"訪問状態");
export const deletionStateLabel=(value:string)=>pick(deletionStates,value,"削除状態");
export const auditResultLabel=(value:string)=>pick(auditResults,value,"監査結果");
export const attemptResultLabel=(value:string)=>pick(attemptResults,value,"試行結果");
export const artifactStateLabel=(value:string)=>pick(artifactStates,value,"成果物状態");
export const auditActionLabel=(value:string)=>auditActions[value]??item("管理操作","操作コードは技術詳細で確認できます","warning");
export const statusDisplayLabel=(value:string)=>jobStates[value]??publicationStates[value]??approvalStates[value]??membershipStates[value]??visitStates[value]??deletionStates[value]??auditResults[value]??artifactStates[value]??(/[ぁ-んァ-ヶ一-龯]/u.test(value)?item(value,"画面で定義された状態"):unknown("状態"));
export const unknownValueLabel=(namespace:string,value:string)=>{void value;return unknown(namespace);};
export const businessText=(value:string)=>value.replace(/承認\s*batch/giu,"承認対象セット").replace(/\bbatch\b/giu,"承認対象セット");

export const contentRoute=(type:ContentType)=>type==="talk"?"/knowledge/talks":type==="flow"?"/knowledge/flows":type==="glossary"||type==="price"?"/knowledge/reference":type==="manual"||type==="legal"?"/knowledge/manuals":type==="video"?"/training/videos":"/training/roleplay";
