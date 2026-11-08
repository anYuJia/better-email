// Rebuild the checked-in v5 artwork from the three supplied reference images.
// Requires macOS (CoreGraphics/ImageIO); generated assets are platform independent.
import AppKit
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let brand = root.appendingPathComponent("assets/brand/v5")
let publicBrand = root.appendingPathComponent("public/brand/v5")
let rgb = CGColorSpaceCreateDeviceRGB()

func load(_ name: String) -> CGImage {
    let url = brand.appendingPathComponent("source/\(name).png")
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fatalError("Cannot read \(url.path)")
    }
    return image
}

func canvas(_ size: Int) -> CGContext {
    guard let context = CGContext(data: nil, width: size, height: size,
        bitsPerComponent: 8, bytesPerRow: size * 4, space: rgb,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        fatalError("Cannot create canvas")
    }
    context.interpolationQuality = .high
    return context
}

func save(_ image: CGImage, _ url: URL) {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Cannot write \(url.path)")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot finish \(url.path)") }
}

// Remove only the near-uniform light/dark background from each supplied
// monochrome image. Retain the original contours and antialiased edges.
func extractMark(_ image: CGImage, light: Bool) -> CGImage {
    let w = image.width, h = image.height
    let ctx = canvas(w)
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    let pixels = ctx.data!.bindMemory(to: UInt8.self, capacity: w * h * 4)
    for i in 0..<(w * h) {
        let offset = i * 4
        let value = (Int(pixels[offset]) + Int(pixels[offset + 1]) + Int(pixels[offset + 2])) / 3
        let strength = light ? value : 255 - value
        let alpha = UInt8(max(0, min(255, (strength - 35) * 255 / 175)))
        let component: UInt8 = light ? alpha : 0 // premultiplied RGBA
        pixels[offset] = component
        pixels[offset + 1] = component
        pixels[offset + 2] = component
        pixels[offset + 3] = alpha
    }
    let full = ctx.makeImage()!
    // Both reference images share a 1254 px canvas. The square crop gives
    // the wide logo breathing room without leaving the original black/white box.
    return full.cropping(to: CGRect(x: 235, y: 240, width: 784, height: 784))!
}

func scaled(_ image: CGImage, size: Int) -> CGImage {
    let ctx = canvas(size)
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    return ctx.makeImage()!
}

try FileManager.default.createDirectory(at: publicBrand, withIntermediateDirectories: true)
let darkMark = extractMark(load("mark-dark"), light: false)
let lightMark = extractMark(load("mark-light"), light: true)
save(scaled(darkMark, size: 512), publicBrand.appendingPathComponent("mark-dark.png"))
save(scaled(lightMark, size: 512), publicBrand.appendingPathComponent("mark-light.png"))
save(scaled(darkMark, size: 64), brand.appendingPathComponent("tray-template.png"))

// The app reference contains a surrounding white canvas and a drop shadow.
// Crop the actual rounded tile and keep its own artwork, rather than baking
// that external canvas/shadow into a platform icon.
let reference = load("app-reference")
let tile = reference.cropping(to: CGRect(x: 139, y: 142, width: 972, height: 972))!
let desktop = canvas(1024)
desktop.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: 1024, height: 1024), cornerWidth: 238, cornerHeight: 238, transform: nil))
desktop.clip()
desktop.draw(tile, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
save(desktop.makeImage()!, brand.appendingPathComponent("app-desktop.png"))
save(scaled(desktop.makeImage()!, size: 64), publicBrand.appendingPathComponent("app-icon-64.png"))
// macOS Dock icons sit inside the system's 1024 px canvas, with clear margin.
let mac = canvas(1024)
mac.draw(desktop.makeImage()!, in: CGRect(x: 100, y: 100, width: 824, height: 824))
save(mac.makeImage()!, brand.appendingPathComponent("app-macos.png"))

// Mobile uses a full-bleed background: iOS and Android supply their own mask.
// Reconstruct the two large background colour fields from the reference, and
// use its exact supplied silhouette as the adaptive foreground.
let mobile = canvas(1024)
let colors = [CGColor(red: 0.96, green: 0.98, blue: 0.97, alpha: 1),
              CGColor(red: 0.89, green: 0.97, blue: 0.92, alpha: 1)] as CFArray
let gradient = CGGradient(colorsSpace: rgb, colors: colors, locations: [0, 1])!
mobile.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 1024), end: CGPoint(x: 1024, y: 0), options: [])
mobile.setFillColor(CGColor(red: 0.73, green: 0.91, blue: 0.80, alpha: 1))
mobile.move(to: CGPoint(x: 0, y: 0))
mobile.addLine(to: CGPoint(x: 1024, y: 0))
mobile.addLine(to: CGPoint(x: 1024, y: 450))
mobile.addCurve(to: CGPoint(x: 0, y: 0), control1: CGPoint(x: 790, y: 80), control2: CGPoint(x: 350, y: 135))
mobile.fillPath()
save(mobile.makeImage()!, brand.appendingPathComponent("android-background.png"))

// CoreGraphics masks use the inverse of an alpha channel when passed directly;
// source-in compositing colors the antialiased mark without changing its outline.
func greenMark() -> CGImage {
    let ctx = canvas(1024)
    ctx.draw(darkMark, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
    ctx.setBlendMode(.sourceIn)
    let greens = [CGColor(red: 0.04, green: 0.61, blue: 0.32, alpha: 1),
                  CGColor(red: 0.0, green: 0.37, blue: 0.22, alpha: 1)] as CFArray
    ctx.drawLinearGradient(CGGradient(colorsSpace: rgb, colors: greens, locations: [0, 1])!,
        start: CGPoint(x: 0, y: 1024), end: CGPoint(x: 1024, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    ctx.setBlendMode(.sourceAtop)
    ctx.setFillColor(CGColor(red: 0.08, green: 0.72, blue: 0.35, alpha: 1))
    // The two speed strokes are separate from the envelope's lower edge.
    ctx.fill(CGRect(x: 680, y: 360, width: 344, height: 90))
    ctx.fill(CGRect(x: 620, y: 250, width: 320, height: 100))
    return ctx.makeImage()!
}
let foreground = greenMark()
mobile.draw(foreground, in: CGRect(x: 120, y: 120, width: 784, height: 784))
save(mobile.makeImage()!, brand.appendingPathComponent("app-mobile.png"))
// Adaptive foregrounds include their own safe zone for circular and other
// launcher masks; the monochrome layer must use the same geometry.
let adaptive = canvas(1024)
adaptive.draw(foreground, in: CGRect(x: 174, y: 174, width: 676, height: 676))
save(adaptive.makeImage()!, brand.appendingPathComponent("android-foreground.png"))
let monochrome = canvas(1024)
monochrome.draw(darkMark, in: CGRect(x: 174, y: 174, width: 676, height: 676))
save(monochrome.makeImage()!, brand.appendingPathComponent("android-monochrome.png"))
