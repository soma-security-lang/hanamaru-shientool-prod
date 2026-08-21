import {fireEvent,render,screen} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {TechnicalDetails} from "./TechnicalDetails";

describe("TechnicalDetails",()=>{
  beforeEach(()=>Object.assign(navigator,{clipboard:{writeText:vi.fn().mockResolvedValue(undefined)}}));
  it("is collapsed initially and omits empty values",()=>{render(<TechnicalDetails items={[{label:"Request ID",value:"req-1"},{label:"空",value:null}]}/>);const details=screen.getByText("技術詳細").closest("details");expect(details).not.toHaveAttribute("open");expect(screen.queryByText("空")).not.toBeInTheDocument();});
  it("copies a value and announces completion",async()=>{render(<TechnicalDetails items={[{label:"Request ID",value:"req-1",copyable:true}]}/>);fireEvent.click(screen.getByRole("button",{name:"Request IDをコピー"}));expect(await screen.findByRole("status")).toHaveTextContent("Request IDをコピーしました");});
});
