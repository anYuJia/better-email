// App Store icons must not carry an alpha channel, even when fully opaque.
import AppKit

let space = CGColorSpaceCreateDeviceRGB()
for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          let context = CGContext(data: nil, width: image.width, height: image.height,
            bitsPerComponent: 8, bytesPerRow: image.width * 4, space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let output = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: image.width,
            pixelsHigh: image.height, bitsPerSample: 8, samplesPerPixel: 3,
            hasAlpha: false, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: image.width * 3, bitsPerPixel: 24) else {
        fatalError("Cannot load icon: \(path)")
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    let input = context.data!.bindMemory(to: UInt8.self, capacity: image.width * image.height * 4)
    let pixels = output.bitmapData!
    for i in 0..<(image.width * image.height) {
        guard input[i * 4 + 3] == 255 else { fatalError("Unexpected transparent pixel: \(path)") }
        pixels[i * 3] = input[i * 4]
        pixels[i * 3 + 1] = input[i * 4 + 1]
        pixels[i * 3 + 2] = input[i * 4 + 2]
    }
    guard let data = output.representation(using: .png, properties: [:]) else { fatalError("Cannot encode \(path)") }
    try data.write(to: url)
}
