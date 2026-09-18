"use client";

import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {usePathname} from "next/navigation";
import {ApiClientError,apiClient} from "@/lib/api/client";
import type {Role} from "@/lib/prototype/types";

export interface Viewer{
  id:string;
  displayName:string;
  organizationName?:string;
  branchName?:string;
  roles:Role[];
  capabilities:string[];
  featureFlags:Record<string,boolean>;
}

export type ViewerAuthState="loading"|"ready"|"required"|"failed";

interface ViewerContextValue{
  viewer:Viewer|null;
  authState:ViewerAuthState;
  retryViewer:()=>void;
}

const ViewerContext=createContext<ViewerContextValue|undefined>(undefined);

function isPublicPath(pathname:string){return pathname==="/login"||pathname==="/__prototype";}

export function ViewerProvider({children}:{children:ReactNode}){
  const pathname=usePathname();
  const [viewer,setViewer]=useState<Viewer|null>(null);
  const [authState,setAuthState]=useState<ViewerAuthState>(()=>isPublicPath(pathname)?"ready":"loading");
  const [refreshVersion,setRefreshVersion]=useState(0);
  const requestRef=useRef<Promise<Viewer>|null>(null);
  const requestEpoch=useRef(0);
  const authenticationBlocked=useRef(false);

  const retryViewer=useCallback(()=>{
    requestEpoch.current+=1;
    requestRef.current=null;
    authenticationBlocked.current=false;
    setViewer(null);
    setAuthState("loading");
    setRefreshVersion(version=>version+1);
  },[]);

  useEffect(()=>{
    const expired=()=>{
      requestEpoch.current+=1;
      requestRef.current=null;
      authenticationBlocked.current=true;
      setViewer(null);
      setAuthState("required");
    };
    const changed=()=>retryViewer();
    window.addEventListener("hanamaru:auth-required",expired);
    window.addEventListener("hanamaru:auth-changed",changed);
    return()=>{
      window.removeEventListener("hanamaru:auth-required",expired);
      window.removeEventListener("hanamaru:auth-changed",changed);
    };
  },[retryViewer]);

  useEffect(()=>{
    if(isPublicPath(pathname)||viewer)return;
    if(authenticationBlocked.current)return;

    let active=true;
    const epoch=requestEpoch.current;
    const request=requestRef.current??apiClient.request<Viewer>("/me");
    requestRef.current=request;
    void request.then(result=>{
      if(!active||requestEpoch.current!==epoch)return;
      setViewer(result);
      setAuthState("ready");
    }).catch(error=>{
      if(!active||requestEpoch.current!==epoch)return;
      setViewer(null);
      const required=error instanceof ApiClientError&&error.status===401;
      authenticationBlocked.current=required;
      setAuthState(required?"required":"failed");
    }).finally(()=>{
      if(requestRef.current===request)requestRef.current=null;
    });
    return()=>{active=false;};
  },[pathname,refreshVersion,viewer]);

  const value=useMemo<ViewerContextValue>(()=>({viewer,authState,retryViewer}),[viewer,authState,retryViewer]);
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(){
  const context=useContext(ViewerContext);
  if(!context)throw new Error("useViewer must be used within ViewerProvider");
  return context;
}
