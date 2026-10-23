import SwiftUI
import UIKit
import WebKit

@main
struct PortalApp: App {
    var body: some Scene {
        WindowGroup {
            PortalWebView()
        }
    }
}

struct PortalWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true

        guard let configuredURL = Bundle.main.object(forInfoDictionaryKey: "PortalURL") as? String,
              let url = URL(string: configuredURL),
              url.scheme == "https",
              url.host == "a-mlogistic.netlify.app" else {
            webView.loadHTMLString(
                "<html><body><p>App setup error. Please contact A&amp;M Logistics support.</p></body></html>",
                baseURL: nil
            )
            return webView
        }

        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if Self.isPortalURL(url) {
                decisionHandler(.allow)
            } else {
                Self.openExternalURL(url)
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let url = navigationAction.request.url else {
                return nil
            }

            if Self.isPortalURL(url) {
                webView.load(navigationAction.request)
            } else {
                Self.openExternalURL(url)
            }
            return nil
        }

        private static func isPortalURL(_ url: URL) -> Bool {
            url.scheme == "https" && url.host == "a-mlogistic.netlify.app"
        }

        private static func openExternalURL(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(),
                  ["https", "http", "mailto", "tel"].contains(scheme) else {
                return
            }
            UIApplication.shared.open(url)
        }
    }
}
