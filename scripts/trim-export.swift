import Foundation
import AVFoundation
import CryptoKit

@main struct TrimExport {
 static func fail(_ message:String) -> NSError {NSError(domain:"PhotosSwipe",code:1,userInfo:[NSLocalizedDescriptionKey:message])}
 struct PresentedSample {
  let digest:String,frameStart:Double,visibleStart:Double,visibleEnd:Double
 }
 static func boundarySample(_ asset:AVURLAsset,_ track:AVAssetTrack,_ time:Double,_ tolerance:Double) async throws -> PresentedSample {
  let segments=try await track.load(.segments)
  let reader=try AVAssetReader(asset:asset),output=AVAssetReaderTrackOutput(track:track,outputSettings:nil);reader.add(output)
  // Compressed readers include decode preroll and return media PTS. The MOV edit
  // mapping, not the first nonnegative packet, determines what is presented.
  reader.timeRange=CMTimeRange(start:CMTime(seconds:max(0,time-tolerance*2),preferredTimescale:60000),duration:CMTime(seconds:2,preferredTimescale:60000))
  guard reader.startReading() else {throw reader.error ?? fail("Cannot inspect boundary samples.")}
  defer {reader.cancelReading()}
  var covering:PresentedSample?=nil,previous:PresentedSample?=nil
  while let sample=output.copyNextSampleBuffer(){let timestamp=CMSampleBufferGetPresentationTimeStamp(sample).seconds,duration=CMSampleBufferGetDuration(sample).seconds
   guard timestamp.isFinite,duration.isFinite,duration>0 else {continue}
   guard CMSampleBufferGetNumSamples(sample)>0,let block=CMSampleBufferGetDataBuffer(sample) else {continue}
   var digest:String?=nil
   for segment in segments where !segment.isEmpty {
    let source=segment.timeMapping.source,target=segment.timeMapping.target
    let sourceStart=source.start.seconds,sourceEnd=source.end.seconds,ratio=target.duration.seconds/source.duration.seconds
    guard sourceStart.isFinite,sourceEnd.isFinite,ratio.isFinite,ratio>0 else {throw fail("Unsupported video edit mapping.")}
    let low=max(timestamp,sourceStart),high=min(timestamp+duration,sourceEnd)
    guard high>low else {continue}
    let frameStart=target.start.seconds+(timestamp-sourceStart)*ratio
    let visibleStart=target.start.seconds+(low-sourceStart)*ratio,visibleEnd=target.start.seconds+(high-sourceStart)*ratio
    let contains=visibleStart<=time+0.000001 && visibleEnd>time+0.000001
    let precedes=visibleEnd<=time+0.000001 && time-visibleEnd<=tolerance+0.000001
    guard contains||precedes else {continue}
    if digest==nil {var bytes=Data(count:CMBlockBufferGetDataLength(block));let result=bytes.withUnsafeMutableBytes {buffer in CMBlockBufferCopyDataBytes(block,atOffset:0,dataLength:buffer.count,destination:buffer.baseAddress!)};guard result==kCMBlockBufferNoErr else {throw fail("Cannot verify boundary video packets.")};digest=SHA256.hash(data:bytes).map {String(format:"%02x",$0)}.joined()}
    let presented=PresentedSample(digest:digest!,frameStart:frameStart,visibleStart:visibleStart,visibleEnd:visibleEnd)
    if contains {if covering==nil||visibleStart>covering!.visibleStart {covering=presented}}
    else if previous==nil||visibleEnd>previous!.visibleEnd {previous=presented}
   }
  }
  if let chosen=covering ?? previous {return chosen}
  throw reader.error ?? fail("No presented video frame exists within one frame of the chosen boundary.")
 }
 static func inspect(_ asset:AVURLAsset) async throws -> [String:Any] {
  let tracks=try await asset.loadTracks(withMediaType:.video)
  guard tracks.count==1,let track=tracks.first else {throw fail("Only single-track videos are supported.")}
  let size=try await track.load(.naturalSize),transform=try await track.load(.preferredTransform),rate=try await track.load(.nominalFrameRate)
  let displayed=size.applying(transform),audio=try await asset.loadTracks(withMediaType:.audio)
  let metadata=try await asset.load(.metadata)
  let formats=try await track.load(.formatDescriptions).map {format -> [String:Any] in
   let extensions=CMFormatDescriptionGetExtensions(format).map { $0 as NSDictionary } ?? NSDictionary()
   return ["codec":CMFormatDescriptionGetMediaSubType(format),"primaries":extensions[kCMFormatDescriptionExtension_ColorPrimaries] ?? NSNull(),"transfer":extensions[kCMFormatDescriptionExtension_TransferFunction] ?? NSNull(),"matrix":extensions[kCMFormatDescriptionExtension_YCbCrMatrix] ?? NSNull()]
  }
  var values:[[String:String]]=[]
  for item in metadata {if let value=try? await item.load(.stringValue),let id=item.identifier?.rawValue {values.append(["id":id,"value":value])}}
  return ["duration":try await asset.load(.duration).seconds,"width":Int(abs(displayed.width).rounded()),"height":Int(abs(displayed.height).rounded()),"frameRate":rate,"frameTolerance":rate>0 ? 1/Double(rate) : 1/30,"audioTracks":audio.count,"transform":[transform.a,transform.b,transform.c,transform.d,transform.tx,transform.ty],"formats":formats,"metadata":values]
 }
 static func main() async throws {
  let args=CommandLine.arguments
  guard args.count>=3 else {throw fail("Use inspect input or export input output start end metadata.json.")}
  let asset=AVURLAsset(url:URL(fileURLWithPath:args[2]))
  if args[1]=="inspect" {print(String(data:try JSONSerialization.data(withJSONObject:try await inspect(asset)),encoding:.utf8)!);return}
  guard args.count==7,let start=Double(args[4]),let end=Double(args[5]),start.isFinite,end.isFinite else {throw fail("Invalid export arguments.")}
  let report=try await inspect(asset),duration=report["duration"] as! Double
  guard start>=0,end<=duration,end-start>=min(0.5,duration),start>0.001||end<duration-0.001 else {throw fail("The preview range is outside the stored original. Reopen the editor using its stored duration.")}
  let output=URL(fileURLWithPath:args[3]);guard !FileManager.default.fileExists(atPath:output.path) else {throw fail("Output already exists; refusing overwrite.")}
  guard let exporter=AVAssetExportSession(asset:asset,presetName:AVAssetExportPresetPassthrough) else {throw fail("This format does not support preserving its quality.")}
  guard exporter.supportedFileTypes.contains(.mov) else {throw fail("Cannot preserve this video in MOV format.")}
  let input=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[6]))) as! [String:Any]
  var metadata=try await asset.load(.metadata)
  if let date=input["date"] as? String {
   metadata.removeAll { $0.identifier == .quickTimeMetadataCreationDate || $0.commonKey == .commonKeyCreationDate }
   var preservedDate=date
   let parser=ISO8601DateFormatter();parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
   let instant=parser.date(from:date) ?? ISO8601DateFormatter().date(from:date)
   if let raw=input["timezoneOffset"] as? Double,let instant=instant {
    let seconds=abs(raw)>86400 ? raw/1000 : raw
    if seconds.rounded()==seconds,abs(seconds)<=14*3600,let timezone=TimeZone(secondsFromGMT:Int(seconds)) {let formatter=ISO8601DateFormatter();formatter.timeZone=timezone;preservedDate=formatter.string(from:instant)}
   }
   let item=AVMutableMetadataItem();item.identifier = .quickTimeMetadataCreationDate;item.value=preservedDate as NSString;item.dataType=kCMMetadataBaseDataType_UTF8 as String;metadata.append(item)
  }
  if let location=input["location"] as? [Double],location.count==2 {
   metadata.removeAll {$0.identifier == .quickTimeMetadataLocationISO6709}
   let item=AVMutableMetadataItem();item.identifier = .quickTimeMetadataLocationISO6709;item.value=String(format:"%+.7f%+.7f/",location[0],location[1]) as NSString;item.dataType=kCMMetadataBaseDataType_UTF8 as String;metadata.append(item)
  }
  exporter.metadata=metadata;exporter.outputURL=output;exporter.outputFileType = .mov
  exporter.timeRange=CMTimeRange(start:CMTime(seconds:start,preferredTimescale:60000),end:CMTime(seconds:end,preferredTimescale:60000))
  try await exporter.export(to:output,as:.mov)
  let exported=AVURLAsset(url:output);var result=try await inspect(exported);let tolerance=report["frameTolerance"] as! Double
  guard abs((result["duration"] as! Double)-(end-start))<=tolerance, result["width"] as! Int == report["width"] as! Int,result["height"] as! Int == report["height"] as! Int,result["audioTracks"] as! Int == report["audioTracks"] as! Int else {throw fail("Export does not match the requested range or original media properties.")}
  let sourceFormats=try JSONSerialization.data(withJSONObject:report["formats"]!,options:.sortedKeys),outputFormats=try JSONSerialization.data(withJSONObject:result["formats"]!,options:.sortedKeys)
  guard sourceFormats==outputFormats else {throw fail("Codec or color properties changed during export.")}
  let sourceTrack=try await asset.loadTracks(withMediaType:.video)[0],outputTrack=try await exported.loadTracks(withMediaType:.video)[0]
  let sourceBoundary=try await boundarySample(asset,sourceTrack,start,tolerance),outputBoundary=try await boundarySample(exported,outputTrack,0,tolerance)
  let startError=abs(sourceBoundary.frameStart-start-outputBoundary.frameStart)
  guard sourceBoundary.digest==outputBoundary.digest,startError<=tolerance else {throw fail("The first presented video frame does not match the chosen boundary. This source needs a different exact exporter.")}
  let outputDuration=result["duration"] as! Double
  let sourceLast=try await boundarySample(asset,sourceTrack,end-0.00001,tolerance),outputLast=try await boundarySample(exported,outputTrack,outputDuration-0.00001,tolerance)
  let endError=abs(sourceLast.frameStart-start-outputLast.frameStart)
  guard sourceLast.digest==outputLast.digest,endError<=tolerance else {throw fail("The last presented video frame does not match the chosen boundary. This source needs a different exact exporter.")}
  result["firstSampleVerified"]=true
  result["lastSampleVerified"]=true;result["startTimingError"]=startError;result["endTimingError"]=endError
  print(String(data:try JSONSerialization.data(withJSONObject:result),encoding:.utf8)!)
 }
}
