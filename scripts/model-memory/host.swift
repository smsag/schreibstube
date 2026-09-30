import AppKit
import WebKit
// host <url> : load the page in a WKWebView, exit when the page logs DONE or ERROR (checked via steps.log)
let url = URL(string: CommandLine.arguments[1])!
let stepsLog = CommandLine.arguments[2]
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300), configuration: config)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
window.contentView = web
window.orderFrontRegardless()
web.load(URLRequest(url: url))
Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
  if let s = try? String(contentsOfFile: stepsLog, encoding: .utf8), s.contains("DONE") || s.contains("ERROR") { exit(0) }
}
Timer.scheduledTimer(withTimeInterval: 400, repeats: false) { _ in exit(1) }
app.run()
