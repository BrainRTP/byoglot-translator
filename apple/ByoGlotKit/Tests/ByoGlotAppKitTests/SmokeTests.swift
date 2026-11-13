import ByoGlotAppKit
import Testing

@Test func limitsComeFromContracts() {
    #expect(extensionInputLimit == 5000)
    #expect(editorInputLimit == 20000)
}
