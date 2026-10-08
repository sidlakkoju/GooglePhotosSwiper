// Synthetic native test media; no account data or network access.
import Foundation
import AVFoundation
import CoreVideo
@main struct TrimFixture {
 static func main() async throws {
  let target=URL(fileURLWithPath:CommandLine.arguments[1]),writer=try AVAssetWriter(outputURL:target,fileType:.mov)
  let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:320,AVVideoHeightKey:180]);input.transform=CGAffineTransform(rotationAngle:.pi/2);writer.add(input)
  let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA,kCVPixelBufferWidthKey as String:320,kCVPixelBufferHeightKey as String:180])
  guard writer.startWriting() else {throw writer.error!};writer.startSession(atSourceTime:.zero)
  let deadline=Date().addingTimeInterval(25)
  for frame in 0..<90 {while !input.isReadyForMoreMediaData {if writer.status == .failed {throw writer.error ?? NSError(domain:"Fixture",code:2)};if Date()>deadline {writer.cancelWriting();throw NSError(domain:"Fixture",code:3,userInfo:[NSLocalizedDescriptionKey:"Synthetic encoder timed out."])};try await Task.sleep(nanoseconds:1_000_000)};var buffer:CVPixelBuffer?;CVPixelBufferCreate(kCFAllocatorDefault,320,180,kCVPixelFormatType_32BGRA,[kCVPixelBufferCGImageCompatibilityKey:true,kCVPixelBufferCGBitmapContextCompatibilityKey:true] as CFDictionary,&buffer);guard let pixels=buffer else {throw NSError(domain:"Fixture",code:1)};CVPixelBufferLockBaseAddress(pixels,[]);memset(CVPixelBufferGetBaseAddress(pixels),Int32(frame*2),CVPixelBufferGetDataSize(pixels));CVPixelBufferUnlockBaseAddress(pixels,[]);guard adaptor.append(pixels,withPresentationTime:CMTime(value:Int64(frame),timescale:30)) else {throw writer.error ?? NSError(domain:"Fixture",code:4)}}
  input.markAsFinished();await writer.finishWriting();if let error=writer.error {throw error}
 }
}
