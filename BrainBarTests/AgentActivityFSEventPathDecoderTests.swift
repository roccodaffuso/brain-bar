import Darwin
import Testing
@testable import BrainBar

struct AgentActivityFSEventPathDecoderTests {
    @Test("FSEvents raw C paths are copied before the callback returns")
    func decodesRawCStringArray() {
        let first = strdup("/tmp/Brain/Notes/One.md")
        let second = strdup("/tmp/Brain/Notes/Caffè.md")
        defer {
            free(first)
            free(second)
        }

        var rawPaths: [UnsafePointer<CChar>?] = [
            first.map { UnsafePointer<CChar>($0) },
            nil,
            second.map { UnsafePointer<CChar>($0) },
        ]
        let decoded = rawPaths.withUnsafeMutableBufferPointer { buffer in
            AgentActivityFSEventPathDecoder.decode(
                UnsafeMutableRawPointer(buffer.baseAddress!),
                count: buffer.count
            )
        }

        #expect(decoded == ["/tmp/Brain/Notes/One.md", "/tmp/Brain/Notes/Caffè.md"])
    }
}
