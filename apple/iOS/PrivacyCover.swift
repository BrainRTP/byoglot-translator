import ByoGlotAppKit
import SwiftUI
import UIKit

@MainActor final class PrivacyCover: NSObject {
    private weak var scene: UIWindowScene?
    private var cover: UIWindow?

    func attach(to scene: UIWindowScene) {
        guard self.scene !== scene else { return }
        NotificationCenter.default.removeObserver(self)
        self.scene = scene
        NotificationCenter.default.addObserver(self, selector: #selector(show), name: UIScene.willDeactivateNotification, object: scene)
        NotificationCenter.default.addObserver(self, selector: #selector(hide), name: UIScene.didActivateNotification, object: scene)
        if scene.activationState != .foregroundActive { show() }
    }

    @objc private func show() {
        guard let scene else { return }
        if cover == nil {
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.isUserInteractionEnabled = false
            window.accessibilityElementsHidden = true
            let controller = UIViewController()
            controller.view.backgroundColor = UIColor(ByoColor.background)
            let title = UILabel()
            title.text = "ByoGlot"
            title.font = .preferredFont(forTextStyle: .title1)
            title.textColor = UIColor(ByoColor.text)
            title.translatesAutoresizingMaskIntoConstraints = false
            controller.view.addSubview(title)
            NSLayoutConstraint.activate([
                title.centerXAnchor.constraint(equalTo: controller.view.centerXAnchor),
                title.centerYAnchor.constraint(equalTo: controller.view.centerYAnchor),
            ])
            window.rootViewController = controller
            cover = window
        }
        cover?.isHidden = false
    }

    @objc private func hide() { cover?.isHidden = true }
}

struct PrivacySceneAttachment: UIViewRepresentable {
    let cover: PrivacyCover
    func makeUIView(context: Context) -> AttachmentView { AttachmentView(cover: cover) }
    func updateUIView(_ view: AttachmentView, context: Context) {}

    final class AttachmentView: UIView {
        let cover: PrivacyCover
        init(cover: PrivacyCover) { self.cover = cover; super.init(frame: .zero); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { nil }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let scene = window?.windowScene { cover.attach(to: scene) }
        }
    }
}
