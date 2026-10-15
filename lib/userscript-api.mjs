import {photosOperation} from '../extension/photos-api.js';
export function createPhotosAPI(environment) {
 return (operation,args={})=>photosOperation(operation,args,environment);
}
