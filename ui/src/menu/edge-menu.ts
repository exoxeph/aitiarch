// The pointer rules of the left menu, with no DOM in them so they can be tested with fake timers.
//  - the pointer dwells in the 8 px edge zone for DWELL_MS: the menu opens (a drag or any held button never opens it);
//  - the pointer leaves both the zone and the menu: it closes LEAVE_MS later, unless it came back;
//  - a click on the hamburger pins it (it stays until clicked again or Escape).
export const DWELL_MS=120,LEAVE_MS=300;
export interface EdgeMenuState {open:boolean;pinned:boolean}

export class EdgeMenuController {
 open=false;pinned=false;
 private zone=false;private menu=false;private down=false;private held=false;
 private dwell:ReturnType<typeof setTimeout>|undefined;private leave:ReturnType<typeof setTimeout>|undefined;
 constructor(private readonly onChange:(state:EdgeMenuState)=>void){}
 private emit(){this.onChange({open:this.open,pinned:this.pinned});}
 private cancelDwell(){if(this.dwell!==undefined){clearTimeout(this.dwell);this.dwell=undefined;}}
 private cancelLeave(){if(this.leave!==undefined){clearTimeout(this.leave);this.leave=undefined;}}
 private scheduleLeave(){
  if(!this.open||this.pinned||this.zone||this.menu||this.held)return;
  this.cancelLeave();
  this.leave=setTimeout(()=>{this.leave=undefined;if(this.open&&!this.pinned&&!this.zone&&!this.menu&&!this.held){this.open=false;this.emit();}},LEAVE_MS);
 }
 /** Something inside the menu (a dialog, a context menu) is open: the pointer leaving must not close the menu under it. */
 hold(on:boolean){this.held=on;if(on)this.cancelLeave();else this.scheduleLeave();}
 /** The pointer entered the edge zone. `buttons` is the pointer event's button mask: any held button means a drag, not a request for the menu. */
 enterZone(buttons=0){
  this.zone=true;this.cancelLeave();
  if(this.open||buttons!==0||this.down)return;
  this.cancelDwell();
  this.dwell=setTimeout(()=>{this.dwell=undefined;if(this.zone&&!this.down&&!this.open){this.open=true;this.emit();}},DWELL_MS);
 }
 leaveZone(){this.zone=false;this.cancelDwell();this.scheduleLeave();}
 enterMenu(){this.menu=true;this.cancelLeave();}
 leaveMenu(){this.menu=false;this.scheduleLeave();}
 pointerDown(){this.down=true;this.cancelDwell();}
 pointerUp(){this.down=false;}
 /** The hamburger: pins the menu open (also when it is only hover-open); a second press unpins and closes it. */
 toggle(){
  this.cancelDwell();this.cancelLeave();
  if(this.open&&this.pinned){this.open=false;this.pinned=false;}else{this.open=true;this.pinned=true;}
  this.emit();
 }
 close(){
  this.cancelDwell();this.cancelLeave();
  if(!this.open&&!this.pinned)return;
  this.open=false;this.pinned=false;this.emit();
 }
 /** True when Escape closed something, so the caller knows whether to keep the key. */
 escape():boolean{if(!this.open)return false;this.close();return true;}
 dispose(){this.cancelDwell();this.cancelLeave();}
}
