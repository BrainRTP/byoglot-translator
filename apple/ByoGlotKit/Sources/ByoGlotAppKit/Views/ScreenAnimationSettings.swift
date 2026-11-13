import ByoGlotCore
import SwiftUI

public struct ScreenAnimationSettings: View {
    @Bindable private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selected: ResultAnimation
    @State private var playback: ResultAnimationPlayback?
    @FocusState private var focused: ResultAnimation?

    public init(model: AppModel) {
        self.model = model
        _selected = State(initialValue: model.settings.resultAnimation)
    }

    public var body: some View {
        SettingsPage(title: "anim.title") {
            if reduceMotion { Note(text: AppStrings.text(reduceMotionKey)) }
            Text(AppStrings.text("anim.tapHint")).modifier(ByoTypography(14)).foregroundStyle(ByoColor.muted)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(ResultAnimation.allCases, id: \.self) { effect in
                    AnimationCard(effect: effect, selected: selected == effect) { choose(effect) }
                        .focused($focused, equals: effect)
                }
            }
            .accessibilityRepresentation {
                Picker(AppStrings.text("anim.group"), selection: Binding(get: { selected }, set: choose)) {
                    ForEach(ResultAnimation.allCases, id: \.self) { effect in Text(AppStrings.text("anim." + effect.rawValue)).tag(effect) }
                }.pickerStyle(.inline)
            }
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
                let values = ResultAnimation.allCases
                let index = values.firstIndex(of: focused ?? selected) ?? 0
                let delta = press.key == .leftArrow ? -1 : press.key == .rightArrow ? 1 : press.key == .upArrow ? -2 : 2
                let next = values[min(values.count - 1, max(0, index + delta))]
                focused = next
                choose(next)
                return .handled
            }
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel("anim.preview")
                ResultText(text: AppStrings.text("anim.sample"), playback: playback)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ByoButton("anim.replay", icon: "arrow.clockwise", action: replay).disabled(reduceMotion)
            }.padding(12).background(ByoColor.background, in: RoundedRectangle(cornerRadius: ByoRadius.group))
                .overlay { RoundedRectangle(cornerRadius: ByoRadius.group).stroke(ByoColor.border).allowsHitTesting(false) }
        }
        .onChange(of: reduceMotion) { _, value in if value { playback = nil } }
        .onChange(of: model.settings.resultAnimation) { _, value in selected = value }
        .onDisappear { playback = nil }
    }

    private var reduceMotionKey: String {
        #if os(iOS)
        "anim.reducedMotion.ios"
        #else
        "anim.reducedMotion.macos"
        #endif
    }

    private func choose(_ effect: ResultAnimation) {
        selected = effect
        replay()
        Task { if !(await model.updateSettings({ $0.resultAnimation = effect })) { selected = model.settings.resultAnimation } }
    }

    private func replay() {
        guard ResultAnimationPolicy.shouldPlay(effect: selected, delivery: .whole, complete: true, incomplete: false, hasText: true, reduceMotion: reduceMotion, isNewResult: true) else {
            playback = nil
            return
        }
        playback = ResultAnimationPlayback(effect: selected)
    }
}

private struct AnimationCard: View {
    let effect: ResultAnimation
    let selected: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 4) {
                    Text(AppStrings.text("anim." + effect.rawValue)).modifier(ByoTypography(16, weight: .semibold))
                    Spacer(minLength: 0)
                    if selected { Image(systemName: "checkmark").foregroundStyle(ByoColor.accent).accessibilityHidden(true) }
                }
                Text(AppStrings.text("anim.detail." + effect.rawValue)).modifier(ByoTypography(15)).foregroundStyle(ByoColor.muted)
            }.frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading).padding(.horizontal, 12).padding(.vertical, 10)
                .background(ByoColor.background, in: RoundedRectangle(cornerRadius: ByoRadius.group))
                .overlay { RoundedRectangle(cornerRadius: ByoRadius.group).stroke(selected ? ByoColor.accent : ByoColor.border, lineWidth: selected ? 2 : 1).allowsHitTesting(false) }
                .contentShape(Rectangle())
        }.buttonStyle(.plain).modifier(ByoFocusRing())
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
