import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {StatusBar} from '../src/components.tsx';

const footer=(rootPath:string)=>renderToStaticMarkup(<StatusBar path="fixture.md" status="saved" text="Synthetic text" eol="CRLF" bom={true} online={true} rootPath={rootPath}/>);
it('footer shows only the folder name, including its tooltip, on Windows and POSIX',()=>{
 for(const root of ['C:\\synthetic\\orders','/synthetic/orders/']){
  const html=footer(root);expect(html).toContain('>orders</span>');expect(html).not.toContain(root);expect(html).not.toContain('synthetic');
 }
});
it('footer passes the path through existing user-path and secret redaction before displaying it',()=>{
 for(const root of ['C:\\Users\\Fictional\\orders','/home/fictional/orders']){
  const html=footer(root);expect(html).toContain('[USER_PATH]');expect(html).not.toContain('fictional');expect(html).not.toContain('Fictional');expect(html).not.toContain('orders');
 }
 expect(footer('C:\\synthetic\\token=fictional-secret')).not.toContain('fictional-secret');
});
