import { PresetRegistry, profileId, type ProfileData, type ProfileKind, type ProfileRecord } from '../src/presets/discovery.js';
import type { Config } from '../src/config.js';
export const machineName='Creality Ender-3 V3 KE 0.4 nozzle';
export const processName='0.20mm Standard @Creality Ender3V3KE';
export const filamentName='Creality Generic PLA @Ender-3V3-all';
export function record(kind:ProfileKind,name:string,data:ProfileData):ProfileRecord {return {kind,name,id:profileId(kind,name),path:`/bundled/${name}.json`,data:{type:kind,name,instantiation:'true',...data}};}
export function registry() {
  return new PresetRegistry([
    record('machine','base',{instantiation:'false',printable_area:['0x0','220x0','220x220','0x220'],printable_height:'245',nozzle_diameter:['0.4'],min_layer_height:['0.08'],max_layer_height:['0.32']}),
    record('machine',machineName,{inherits:'base',default_print_profile:processName,default_filament_profile:[filamentName]}),
    record('machine','Other Printer 0.4 nozzle',{inherits:'base'}),
    record('process','common',{instantiation:'false',wall_loops:'2',layer_height:'0.2'}),
    record('process',processName,{inherits:'common',compatible_printers:[machineName]}),
    record('process','Other process',{inherits:'common',compatible_printers:['Other Printer 0.4 nozzle']}),
    record('filament',filamentName,{compatible_printers:[machineName]}),
  ]);
}
export function config(dataDir:string,binary='/missing-orca'):Config {return {dataDir,orcaBin:binary,orcaResources:'/missing-resources',webDist:'/missing-web',port:8084,host:'127.0.0.1',maxUploadMb:1,maxConcurrentSlices:1,slicerTimeoutSeconds:2};}
