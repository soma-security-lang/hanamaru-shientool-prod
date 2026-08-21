const roundConstants = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function rotateRight(value:number,bits:number){return(value>>>bits)|(value<<(32-bits));}

export class IncrementalSha256 {
  private readonly state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  private readonly pending=new Uint8Array(64);
  private pendingLength=0;
  private bytesHashed=0;
  private finalized=false;

  update(chunk:Uint8Array){
    if(this.finalized)throw new Error("SHA-256は確定済みです");
    this.bytesHashed+=chunk.byteLength;
    let offset=0;
    if(this.pendingLength){
      const copyLength=Math.min(64-this.pendingLength,chunk.byteLength);
      this.pending.set(chunk.subarray(0,copyLength),this.pendingLength);
      this.pendingLength+=copyLength;offset+=copyLength;
      if(this.pendingLength===64){this.processBlock(this.pending,0);this.pendingLength=0;}
    }
    while(offset+64<=chunk.byteLength){this.processBlock(chunk,offset);offset+=64;}
    if(offset<chunk.byteLength){this.pending.set(chunk.subarray(offset),0);this.pendingLength=chunk.byteLength-offset;}
    return this;
  }

  digestHex(){
    if(this.finalized)throw new Error("SHA-256は確定済みです");
    this.finalized=true;
    const finalBlock=new Uint8Array(this.pendingLength<56?64:128);
    finalBlock.set(this.pending.subarray(0,this.pendingLength));
    finalBlock[this.pendingLength]=0x80;
    const bitLength=this.bytesHashed*8;
    const view=new DataView(finalBlock.buffer);
    view.setUint32(finalBlock.byteLength-8,Math.floor(bitLength/0x1_0000_0000),false);
    view.setUint32(finalBlock.byteLength-4,bitLength>>>0,false);
    for(let offset=0;offset<finalBlock.byteLength;offset+=64)this.processBlock(finalBlock,offset);
    return Array.from(this.state,value=>value.toString(16).padStart(8,"0")).join("");
  }

  private processBlock(data:Uint8Array,offset:number){
    const words=new Uint32Array(64);const view=new DataView(data.buffer,data.byteOffset+offset,64);
    for(let index=0;index<16;index++)words[index]=view.getUint32(index*4,false);
    for(let index=16;index<64;index++){
      const before15=words[index-15];const before2=words[index-2];
      const sigma0=rotateRight(before15,7)^rotateRight(before15,18)^(before15>>>3);
      const sigma1=rotateRight(before2,17)^rotateRight(before2,19)^(before2>>>10);
      words[index]=(words[index-16]+sigma0+words[index-7]+sigma1)>>>0;
    }
    let[a,b,c,d,e,f,g,h]=this.state;
    for(let index=0;index<64;index++){
      const sum1=rotateRight(e,6)^rotateRight(e,11)^rotateRight(e,25);
      const choice=(e&f)^((~e)&g);
      const first=(h+sum1+choice+roundConstants[index]+words[index])>>>0;
      const sum0=rotateRight(a,2)^rotateRight(a,13)^rotateRight(a,22);
      const majority=(a&b)^(a&c)^(b&c);
      const second=(sum0+majority)>>>0;
      h=g;g=f;f=e;e=(d+first)>>>0;d=c;c=b;b=a;a=(first+second)>>>0;
    }
    this.state[0]=(this.state[0]+a)>>>0;this.state[1]=(this.state[1]+b)>>>0;
    this.state[2]=(this.state[2]+c)>>>0;this.state[3]=(this.state[3]+d)>>>0;
    this.state[4]=(this.state[4]+e)>>>0;this.state[5]=(this.state[5]+f)>>>0;
    this.state[6]=(this.state[6]+g)>>>0;this.state[7]=(this.state[7]+h)>>>0;
  }
}

export async function sha256Blob(blob:Blob){
  const hash=new IncrementalSha256();const reader=blob.stream().getReader();let bytesSinceYield=0;
  try{
    while(true){
      const{done,value}=await reader.read();if(done)break;
      hash.update(value);bytesSinceYield+=value.byteLength;
      if(bytesSinceYield>=16*1024*1024){bytesSinceYield=0;await new Promise<void>(resolve=>setTimeout(resolve,0));}
    }
  }finally{reader.releaseLock();}
  return hash.digestHex();
}
