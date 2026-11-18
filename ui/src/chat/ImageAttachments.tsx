export function ImageInterpretationNotice({shown}:{shown?:true}){
 return shown?<p className="chat-warn" role="note">interpretation of your image, not verified</p>:null;
}
