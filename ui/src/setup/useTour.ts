import {useEffect,useState} from 'react';
import {api} from '../api.ts';
import type {TourOutcome,TourStatus} from '../../shared/tour-state.ts';
import {shouldOfferTour} from './tour-model.ts';

export function useTour(setupSettled:boolean){
 const [status,setStatus]=useState<TourStatus>();
 const [open,setOpen]=useState(false);
 useEffect(()=>{if(shouldOfferTour(status,setupSettled))setOpen(true);},[status,setupSettled]);
 return {
  open,
  restore:setStatus,
  replay:()=>setOpen(true),
  close:(outcome:TourOutcome)=>{
   setOpen(false);
   if(status===undefined)return;
   setStatus(outcome);
   void api.saveTour(outcome).catch(error=>console.warn('Tour progress could not be saved.',error));
  },
 };
}
