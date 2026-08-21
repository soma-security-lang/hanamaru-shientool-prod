import {describe,expect,it} from "vitest";
import {approvalStateLabel,businessText,contentTypeLabel,entityTypeLabel,jobStateLabel,jobTypeLabel,membershipStateLabel,publicationStateLabel,unknownValueLabel} from "./index";

describe("UI vocabulary",()=>{
  it.each(["talk","flow","glossary","price","manual","legal","video","roleplay"])("labels content type %s in Japanese",value=>{
    expect(contentTypeLabel(value).label).not.toBe(value);
  });
  it.each(["queued","running","retry_wait","succeeded","failed","cancelled"])("labels job state %s with guidance",value=>{
    const display=jobStateLabel(value);expect(display.label).not.toBe(value);expect(display.description).toBeTruthy();expect(display.tone).toBeTruthy();
  });
  it.each(["draft","published"])("labels publication state %s",value=>expect(publicationStateLabel(value).label).not.toBe(value));
  it.each(["in_review","approved","rejected"])("labels approval state %s",value=>expect(approvalStateLabel(value).label).not.toBe(value));
  it.each(["active","invited","suspended"])("labels membership state %s",value=>expect(membershipStateLabel(value).label).not.toBe(value));
  it("labels known job and entity types",()=>{expect(jobTypeLabel("transcribe").label).toBe("文字起こし");expect(entityTypeLabel("recording").label).toBe("録音");});
  it("fails visibly without using a raw value as the primary label",()=>{expect(unknownValueLabel("処理状態","future_state")).toMatchObject({label:"未定義の状態",tone:"warning"});});
  it("replaces implementation wording in API-provided business text",()=>{
    expect(businessText("承認batch")).toBe("承認対象セット");
    expect(businessText("価格batch 2026-08")).toBe("価格承認対象セット 2026-08");
  });
});
