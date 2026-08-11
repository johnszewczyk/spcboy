#include "play_psf_bridge.h"

#include "PsfBase.h"
#include "PsfLoader.h"
#include "PsfPathToken.h"
#include "PsfStreamProvider.h"
#include "PsfTags.h"
#include "PsfVm.h"
#include "AppConfig.h"
#include "PathUtils.h"
#include "StdStream.h"
#include "StdStreamUtils.h"
#include "sound/SoundHandler.h"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

fs::path CAppConfig::GetBasePath() const {
    static const fs::path basePath = [] {
        const char* configuredPath = std::getenv("SPCBOY_PLAY_DATA_PATH");
        const fs::path result = configuredPath && configuredPath[0]
            ? fs::path(configuredPath)
            : fs::path("/tmp/SPCBoy-PlayData");
        Framework::PathUtils::EnsurePathExists(result);
        return result;
    }();
    return basePath;
}

namespace {

constexpr int kSampleRate = 44100;
constexpr size_t kBufferedFrameCapacity = kSampleRate;
constexpr size_t kPsfWriteBlockSamples = 44 * 2 * 10;
constexpr auto kInitialAudioWait = std::chrono::seconds(5);
constexpr auto kSteadyStateAudioWait = std::chrono::milliseconds(250);

class CaptureSoundHandler final : public CSoundHandler {
public:
    CaptureSoundHandler() : m_samples(kBufferedFrameCapacity * 2) {}

    void Reset() override {
        std::lock_guard lock(m_mutex);
        m_readIndex = 0;
        m_writeIndex = 0;
        m_sampleCount = 0;
        m_hasProducedAudio = false;
        m_condition.notify_all();
    }

    void Write(int16_t* samples, unsigned int sampleCount, unsigned int sampleRate) override {
        if(sampleRate != kSampleRate) return;
        std::lock_guard lock(m_mutex);
        if((m_samples.size() - m_sampleCount) < sampleCount) return;
        for(size_t index = 0; index < sampleCount; index++) {
            m_samples[m_writeIndex] = samples[index];
            m_writeIndex = (m_writeIndex + 1) % m_samples.size();
        }
        m_sampleCount += sampleCount;
        m_hasProducedAudio = true;
        m_condition.notify_all();
    }

    bool HasFreeBuffers() override {
        std::lock_guard lock(m_mutex);
        return (m_samples.size() - m_sampleCount) >= kPsfWriteBlockSamples;
    }

    void RecycleBuffers() override {}

    int32_t Read(int16_t* output, int32_t frameCount) {
        std::unique_lock lock(m_mutex);
        const auto wait = m_hasProducedAudio ? kSteadyStateAudioWait : kInitialAudioWait;
        m_condition.wait_for(lock, wait, [&] {
            return m_sampleCount >= static_cast<size_t>(frameCount) * 2;
        });
        const auto availableFrames = static_cast<int32_t>(m_sampleCount / 2);
        const auto frames = std::min(frameCount, availableFrames);
        const auto samplesToRead = static_cast<size_t>(frames) * 2;
        for(size_t index = 0; index < samplesToRead; index++) {
            output[index] = m_samples[m_readIndex];
            m_readIndex = (m_readIndex + 1) % m_samples.size();
        }
        m_sampleCount -= samplesToRead;
        m_condition.notify_all();
        return frames;
    }

private:
    std::mutex m_mutex;
    std::condition_variable m_condition;
    std::vector<int16_t> m_samples;
    size_t m_readIndex = 0;
    size_t m_writeIndex = 0;
    size_t m_sampleCount = 0;
    bool m_hasProducedAudio = false;
};

struct Metadata {
    CPsfBase::TagMap tags;
    std::map<std::string, std::string> exportedTags;
    int64_t playLengthFrames = 0;
    int64_t fadeLengthFrames = 0;
    std::string systemName;

    explicit Metadata(const char* filePath) {
        if(!filePath || !filePath[0]) throw std::runtime_error("PSF path is empty");
        auto stream = Framework::CreateInputStdStream(fs::path(filePath).native());
        CPsfBase psfFile(stream);
        switch(psfFile.GetVersion()) {
        case CPsfBase::VERSION_PLAYSTATION: systemName = "PlayStation"; break;
        case CPsfBase::VERSION_PLAYSTATION2: systemName = "PlayStation 2"; break;
        default: throw std::runtime_error("File is not a supported PlayStation PSF");
        }
        tags.insert(psfFile.GetTagsBegin(), psfFile.GetTagsEnd());
        exportedTags.insert(tags.begin(), tags.end());
        playLengthFrames = ParseTimeFrames(tags, "length");
        fadeLengthFrames = ParseTimeFrames(tags, "fade");
    }

    static int64_t ParseTimeFrames(const CPsfBase::TagMap& values, const char* name) {
        const auto it = values.find(name);
        if(it == values.end()) return 0;
        try {
            const auto wideLength = CPsfPathToken::WidenString(it->second);
            return static_cast<int64_t>(CPsfTags::ConvertTimeString(wideLength.c_str()) * kSampleRate);
        } catch(...) {
            return 0;
        }
    }
};

struct Player {
    CPsfVm vm;
    CaptureSoundHandler* sound = nullptr;
    CPsfBase::TagMap tags;
    std::map<std::string, std::string> exportedTags;
    std::string path;
    std::string systemName;
    int64_t playedFrames = 0;
    int64_t playLengthFrames = 0;
    int64_t fadeLengthFrames = 0;
    bool longPlay = false;

    explicit Player(const char* filePath) : path(filePath ? filePath : "") {
        if(path.empty()) throw std::runtime_error("PSF path is empty");
        Metadata metadata(path.c_str());
        systemName = metadata.systemName;
        Load();
    }

    ~Player() { vm.Pause(); }

    void Load() {
        vm.Pause();
        vm.Reset();
        tags.clear();
        const auto token = CPhysicalPsfStreamProvider::GetPathTokenFromFilePath(fs::path(path));
        vm.SetSpuHandler([this] {
            sound = new CaptureSoundHandler();
            return sound;
        });
        CPsfLoader::LoadPsf(vm, token, fs::path(), &tags);
        vm.SetReverbEnabled(true);
        exportedTags.clear();
        for(const auto& [key, value] : tags) exportedTags.emplace(key, value);
        playLengthFrames = Metadata::ParseTimeFrames(tags, "length");
        fadeLengthFrames = Metadata::ParseTimeFrames(tags, "fade");
        playedFrames = 0;
        vm.Resume();
    }
};

} // namespace

extern "C" void* spcboy_play_psf_open(const char* path) {
    try { return new Player(path); }
    catch(const std::exception& exception) { std::fprintf(stderr, "Play! PSF open failed: %s\n", exception.what()); return nullptr; }
    catch(...) { std::fprintf(stderr, "Play! PSF open failed.\n"); return nullptr; }
}

extern "C" void spcboy_play_psf_close(void* handle) { delete static_cast<Player*>(handle); }

extern "C" int32_t spcboy_play_psf_read(void* handle, int16_t* output, int32_t frameCount) {
    if(!handle || !output || frameCount <= 0) return -1;
    auto* player = static_cast<Player*>(handle);
    if(!player->longPlay && player->playLengthFrames > 0 && player->playedFrames >= player->playLengthFrames) {
        std::fill(output, output + frameCount * 2, 0);
        player->playedFrames += frameCount;
        return frameCount;
    }
    const auto frames = player->sound ? player->sound->Read(output, frameCount) : 0;
    player->playedFrames += frames;
    return frames;
}

extern "C" int32_t spcboy_play_psf_seek(void* handle, int64_t frame) {
    if(!handle || frame < 0) return -1;
    auto* player = static_cast<Player*>(handle);
    try {
        player->Load();
        std::vector<int16_t> scratch(2048 * 2);
        while(player->playedFrames < frame) {
            const auto requested = static_cast<int32_t>(std::min<int64_t>(2048, frame - player->playedFrames));
            const auto read = spcboy_play_psf_read(player, scratch.data(), requested);
            if(read <= 0) break;
        }
        return 0;
    } catch(const std::exception& exception) { std::fprintf(stderr, "Play! PSF seek failed: %s\n", exception.what()); return -1; }
    catch(...) { std::fprintf(stderr, "Play! PSF seek failed.\n"); return -1; }
}

extern "C" void spcboy_play_psf_set_long_play(void* handle, int32_t enabled) {
    if(handle) static_cast<Player*>(handle)->longPlay = enabled != 0;
}

extern "C" int32_t spcboy_play_psf_finished(void* handle) {
    if(!handle) return 1;
    auto* player = static_cast<Player*>(handle);
    return !player->longPlay && player->playLengthFrames > 0 && player->playedFrames >= player->playLengthFrames;
}

extern "C" int64_t spcboy_play_psf_played_frames(void* handle) {
    return handle ? static_cast<Player*>(handle)->playedFrames : 0;
}

extern "C" int64_t spcboy_play_psf_play_length_frames(void* handle) {
    return handle ? static_cast<Player*>(handle)->playLengthFrames : 0;
}

extern "C" int64_t spcboy_play_psf_fade_length_frames(void* handle) {
    return handle ? static_cast<Player*>(handle)->fadeLengthFrames : 0;
}

extern "C" const char* spcboy_play_psf_tag(void* handle, const char* name) {
    if(!handle || !name) return nullptr;
    auto& tags = static_cast<Player*>(handle)->exportedTags;
    const auto it = tags.find(name);
    return it == tags.end() ? nullptr : it->second.c_str();
}

extern "C" const char* spcboy_play_psf_system_name(void* handle) {
    return handle ? static_cast<Player*>(handle)->systemName.c_str() : nullptr;
}

extern "C" void* spcboy_play_psf_metadata_open(const char* path) {
    try { return new Metadata(path); }
    catch(const std::exception& exception) { std::fprintf(stderr, "Play! PSF metadata failed: %s\n", exception.what()); return nullptr; }
    catch(...) { std::fprintf(stderr, "Play! PSF metadata failed.\n"); return nullptr; }
}

extern "C" void spcboy_play_psf_metadata_close(void* handle) { delete static_cast<Metadata*>(handle); }

extern "C" int64_t spcboy_play_psf_metadata_play_length_frames(void* handle) {
    return handle ? static_cast<Metadata*>(handle)->playLengthFrames : 0;
}

extern "C" int64_t spcboy_play_psf_metadata_fade_length_frames(void* handle) {
    return handle ? static_cast<Metadata*>(handle)->fadeLengthFrames : 0;
}

extern "C" const char* spcboy_play_psf_metadata_tag(void* handle, const char* name) {
    if(!handle || !name) return nullptr;
    auto& tags = static_cast<Metadata*>(handle)->exportedTags;
    const auto it = tags.find(name);
    return it == tags.end() ? nullptr : it->second.c_str();
}

extern "C" const char* spcboy_play_psf_metadata_system_name(void* handle) {
    return handle ? static_cast<Metadata*>(handle)->systemName.c_str() : nullptr;
}
