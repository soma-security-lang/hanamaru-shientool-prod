import type {ContentRepository} from "./types";
export async function getContentRepository():Promise<ContentRepository>{const {RemoteContentRepository}=await import("./remoteRepository");return new RemoteContentRepository();}
