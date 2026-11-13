import ByoGlotCore
import SwiftUI
import UniformTypeIdentifiers

public struct SettingsDocument: FileDocument {
    public static var readableContentTypes: [UTType] { [.json] }
    public var data: Data
    public init(data: Data) { self.data = data }
    public init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    public func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

public struct ScreenAbout: View {
    @Bindable var model: AppModel
    @State private var importing = false
    @State private var exporting = false
    @State private var document: SettingsDocument?
    @State private var review: ExportFile?
    @State private var failure: String?
    @State private var success = false
    @State private var applying = false
    public init(model: AppModel) { self.model = model }
    public var body: some View {
        SettingsPage(title: "settings.about") {
            Text("ByoGlot").modifier(ByoTypography(22, weight: .semibold))
            Text(AppStrings.format("about.version", ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""])).modifier(ByoTypography())
            Note(text: AppStrings.text("about.exportHelp"))
            ByoButton("about.export") { Task {
                do { document = SettingsDocument(data: try await model.exportData()); exporting = true; failure = nil }
                catch { failure = AppStrings.text("about.fileError") }
            } }
            ByoButton("about.import") { importing = true; success = false; failure = nil }
            if let failure { Banner(title: AppStrings.text("about.fileError"), message: failure, actionTitle: "common.close") { self.failure = nil } }
            if success { Note(text: AppStrings.text("about.imported")) }
            Link(AppStrings.text("about.privacy"), destination: URL(string: "https://github.com/BrainRTP/byoglot-translator/blob/main/PRIVACY.md")!).frame(minHeight: 44)
            Link(AppStrings.text("about.source"), destination: URL(string: "https://github.com/BrainRTP/byoglot-translator")!).frame(minHeight: 44)
        }.fileImporter(isPresented: $importing, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                do { review = try ExportFile.decode(Data(contentsOf: url)); failure = nil }
                catch { failure = AppStrings.text("about.invalidFile") }
            case .failure(let error): if (error as NSError).code != NSUserCancelledError { failure = AppStrings.text("about.fileError") }
            }
        }
        .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: "ByoGlot.byoglot.json") { result in
            if case .failure(let error) = result, (error as NSError).code != NSUserCancelledError { failure = AppStrings.text("about.fileError") }
            document = nil
        }
        .sheet(isPresented: Binding(get: { review != nil }, set: { if !$0 && !applying { review = nil } })) {
            if let review {
                ByoBottomSheet("about.importReview", close: { if !applying { self.review = nil } }) {
                    VStack(alignment: .leading, spacing: 16) {
                        Note(text: AppStrings.text("about.replaceHelp"))
                        importDetails(review)
                        ByoButton("about.applyImport", kind: .primary, busy: applying) { Task {
                            applying = true
                            if await model.applyImport(review) { self.review = nil; success = true }
                            else { failure = AppStrings.text("about.fileError") }
                            applying = false
                        } }
                        ByoButton("common.cancel") { self.review = nil }.disabled(applying)
                    }
                }.interactiveDismissDisabled(applying)
            }
        }
    }
    private func importDetails(_ file: ExportFile) -> some View {
        let replaced = file.templates.filter { imported in model.settings.templates.contains { $0.id == imported.id } }.map(templateLabel)
        let added = file.templates.filter { imported in !model.settings.templates.contains { $0.id == imported.id } }.map(templateLabel)
        let profiles = file.profileOverrides.keys.sorted().map(AppStrings.profile)
        let newConnections = file.connections.filter { imported in !model.settings.connections.contains { $0.id == imported.id } }.map(\.name)
        return VStack(alignment: .leading, spacing: 12) {
            Text(AppStrings.format("about.globals", ["source": file.globals.sourceLang == "auto" ? AppStrings.text("lang.auto") : AppStrings.language(file.globals.sourceLang), "target": AppStrings.language(file.globals.targetLang), "profile": AppStrings.profile(file.globals.languageProfile), "enabled": AppStrings.text(file.globals.languagePromptEnabled ? "common.on" : "common.off"), "template": file.templates.first(where: { $0.id == file.globals.defaultTemplateId }).map(templateLabel) ?? file.globals.defaultTemplateId])).modifier(ByoTypography())
            detail("about.replacedTemplates", values: replaced)
            detail("about.addedTemplates", values: added)
            detail("about.replacedProfiles", values: profiles)
            detail("about.addedConnections", values: newConnections)
            detail("about.replacedRules", values: file.siteRules.filter { imported in model.settings.siteRules.contains { $0.id == imported.id } }.map(\.pattern))
            Text(AppStrings.format("about.rules", ["n": String(file.siteRules.count)])).modifier(ByoTypography(13)).foregroundStyle(ByoColor.muted)
            Note(text: AppStrings.text("about.importKeys"))
        }
    }
    private func detail(_ title: String, values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(title)
            Text(values.isEmpty ? AppStrings.text("effort.none") : values.joined(separator: ", ")).modifier(ByoTypography())
        }
    }
}
