#include <iostream>
#include "sseqplayer/XSFPlayer_2SF.h"
#include "sseqplayer/consts.h"
#include "desmume/arm_jit.h"
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <signal.h>

#ifdef _WIN32
#include <io.h>
#include <fcntl.h>

#define MAIN wmain
#define cerr wcerr
#define _T(x) L##x
#define A_TO_I(x) _wtoi(x)
#define A_TO_D(x) std::wcstod(x, nullptr)
using string = std::wstring;
using oschar = wchar_t;
#else
#define MAIN main
#define _T(x) x
#define A_TO_I(x) std::atoi(x)
#define A_TO_D(x) std::strtod(x, nullptr)
using string = std::string;
using oschar = char;
#endif

std::vector<uint8_t> littleEndian(uint32_t value) {
  return std::vector<uint8_t>({
    uint8_t(value),
    uint8_t(value >> 8),
    uint8_t(value >> 16),
    uint8_t(value >> 24)
  });
}

static bool done = false;
static bool stopNow = false;

void sighandler(int signal) {
  stopNow = true;
}

int MAIN(int argc, oschar** argv) {
  std::vector<string> args;
  for (int i = 1; i < argc; i++) {
    args.push_back(argv[i]);
  }

  bool unexpected = false;
  bool raw = false;
  bool infinitely = false;
  bool jit = false;
  bool helpPipe = false;
  double sampleRate = ARM7_CLOCK / 1024.0;
  double speedFactor = 1.0;
  double limitSeconds = -1;
  double fadeSeconds = 5;
  int frameSkip = -1;
  VolumeType volumeType = VOLUMETYPE_NONE;
  PeakType peakType = PEAKTYPE_NONE;
  string rgVolume, rgPeak;
  XSFPlayer_2SF::InterpolationMode interpMode = XSFPlayer_2SF::IM_None;
  string inputFilename, outputFilename;
  for (unsigned int i = 0; i < args.size(); i++) {
    if (args[i] == _T("--rate")) {
      ++i;
      sampleRate = A_TO_I(args[i].c_str());
    } else if (args[i] == _T("--length")) {
      ++i;
      limitSeconds = A_TO_D(args[i].c_str());
    } else if (args[i] == _T("--fade")) {
      ++i;
      fadeSeconds = A_TO_D(args[i].c_str());
    } else if (args[i] == _T("--skip")) {
      ++i;
      frameSkip = A_TO_D(args[i].c_str());
    } else if (args[i] == _T("--speed")) {
      ++i;
      speedFactor = A_TO_D(args[i].c_str());
      if (args[i][args[i].size() - 1] == '%') {
        speedFactor /= 100.0;
      }
    } else if (args[i] == _T("--interp")) {
      ++i;
      if (args[i] == _T("linear")) {
        interpMode = XSFPlayer_2SF::IM_Linear;
      } else if (args[i] == _T("cosine")) {
        interpMode = XSFPlayer_2SF::IM_Cosine;
      } else if (args[i] == _T("sharp")) {
        interpMode = XSFPlayer_2SF::IM_Sharp;
      } else {
        interpMode = XSFPlayer_2SF::IM_None;
      }
    } else if (args[i] == _T("--raw")) {
      raw = true;
    } else if (args[i] == _T("--inf")) {
      infinitely = true;
    } else if (args[i] == _T("--jit")) {
      jit = true;
    } else if (args[i] == _T("--help-pipe")) {
      helpPipe = true;
    } else if (args[i] == "--rg-gain") {
      ++i;
      if (args[i] == _T("album")) {
        volumeType = VOLUMETYPE_REPLAYGAIN_ALBUM;
      } else if (args[i] == _T("track")) {
        volumeType = VOLUMETYPE_REPLAYGAIN_TRACK;
      } else {
        volumeType = VOLUMETYPE_REPLAYGAIN_TRACK;
        rgVolume = args[i];
      }
    } else if (args[i] == "--rg-peak") {
      ++i;
      if (args[i] == _T("album")) {
        peakType = PEAKTYPE_REPLAYGAIN_ALBUM;
      } else if (args[i] == _T("track")) {
        peakType = PEAKTYPE_REPLAYGAIN_TRACK;
      } else {
        peakType = PEAKTYPE_REPLAYGAIN_TRACK;
        rgPeak = args[i];
      }
    } else if (inputFilename.empty()) {
      inputFilename = args[i];
    } else if (outputFilename.empty()) {
      outputFilename = args[i];
    } else {
      unexpected = true;
    }
  }

  if (inputFilename.empty() || outputFilename.empty() || sampleRate <= 0 || unexpected || helpPipe) {
    std::cerr << _T("Usage: ") << argv[0] << _T(" [--rate N] [--interp MODE] [--length SECONDS] [--fade SECONDS] [--speed MULT] [--skip N] [--rg-gain GAIN] [--rg-peak PEAK] [OPTIONS] <input.2sf> <output.wav>") << std::endl;
    std::cerr << _T("  --rate       Specifies the sample rate (default 32728.498)") << std::endl;
    std::cerr << _T("  --length     Stop playback after the specified duration (default unlimited)") << std::endl;
    std::cerr << _T("  --fade       Fade out for the specified duration (default 5 seconds)") << std::endl;
    std::cerr << _T("  --speed      Adjust the playback speed by a factor of MULT (default 100%)") << std::endl;
    std::cerr << _T("               MULT may be specified as a number or a percentage.") << std::endl;
    std::cerr << _T("  --interp     Specifies the interpolation mode (default none)") << std::endl;
    std::cerr << _T("    none         No interpolation") << std::endl;
    std::cerr << _T("    linear       Linear interpolation") << std::endl;
    std::cerr << _T("    cosine       Cosine interpolation") << std::endl;
    std::cerr << _T("    sharp        Sharp interpolation") << std::endl;
    std::cerr << _T("  --raw        Output raw PCM") << std::endl;
    std::cerr << _T("  --inf        Play infinitely") << std::endl;
    std::cerr << _T("  --jit        Enable Just In Time Compiler ARM CPU core") << std::endl;
    std::cerr << _T("  --skip       Skips the first N frames of output (default read from _frames tag)") << std::endl;
    std::cerr << _T("  --rg-gain    Sets the ReplayGain gain to use (default album)") << std::endl;
    std::cerr << _T("    album        Use the REPLAYGAIN_ALBUM_GAIN tag") << std::endl;
    std::cerr << _T("    track        Use the REPLAYGAIN_TRACK_GAIN tag") << std::endl;
    std::cerr << _T("    a number     Use the specified number as the gain") << std::endl;
    std::cerr << _T("  --rg-peak    Sets the ReplayGain peak amplitude to use (default track)") << std::endl;
    std::cerr << _T("    album        Use the REPLAYPEAK_ALBUM_PEAK tag") << std::endl;
    std::cerr << _T("    track        Use the REPLAYPEAK_TRACK_PEAK tag") << std::endl;
    std::cerr << _T("    a number     Use the specified number as the peak amplitude") << std::endl;
    std::cerr << std::endl;
    std::cerr << _T("If the output filename is -, then 2sf2wav will write the wave data to stdout.") << std::endl;
    std::cerr << std::endl;
    std::cerr << _T("If the input filename is -, then 2sf2wav will accept a merged ROM on stdin.") << std::endl;
    return 1;
  }

  if (inputFilename == _T("-") && limitSeconds <= 0 && !infinitely) {
    limitSeconds = 115;
  }

  try {
    XSFPlayer_2SF player(inputFilename);
    player.SetSampleRate(sampleRate / speedFactor);
    player.SetInterpolationMode(interpMode);
    if (limitSeconds > 0) {
      player.SetLength(limitSeconds * 1000, fadeSeconds * 1000);
    }
    if (!rgVolume.empty()) {
      player.GetXSFFile()->SetTag("replaygain_track_gain", rgVolume);
    }
    if (!rgPeak.empty()) {
      player.GetXSFFile()->SetTag("replaygain_track_peak", rgPeak);
    }
    if (volumeType != VOLUMETYPE_NONE || peakType != PEAKTYPE_NONE) {
      player.SetVolumeType(volumeType, peakType);
    }
    if (infinitely) player.PlayInfinitely();
    if (jit) {
      if (DESMUME_JIT_SUPPORTED) {
        player.EnableJIT();
      } else {
        std::cerr << _T("Warning: JIT is not supported on this architecture") << std::endl;
      }
    }
    bool ok = player.Load(frameSkip);
    if (!ok) {
      std::cerr << _T("failed to load") << std::endl;
      return 1;
    }
    player.SeekTop();

    std::ostream* output = nullptr;
    std::unique_ptr<std::ofstream> foutput;

#ifdef _WIN32
    if (outputFilename == _T("-")) {
      outputFilename = L"nul";
      _setmode(_fileno(stdout), _O_BINARY);
      output = &std::cout;
      foutput = nullptr;
    }
#else
    if (outputFilename == "-") {
      outputFilename = "/dev/stdout";
    }
#endif
    if (!output) {
      foutput.reset(new std::ofstream(outputFilename.c_str(), std::ios::out | std::ios::binary));
      output = foutput.get();
    }
    if (!raw) {
      std::vector<uint8_t> SR = littleEndian(sampleRate), BR = littleEndian(sampleRate * 2 * 2);
      std::vector<uint8_t> riff({
        'R', 'I', 'F', 'F',         // Chunk ID
        0xFF, 0xFF, 0xFF, 0xFF,     // Chunk size: will fill in afterward
        'W', 'A', 'V', 'E',         // Format
        'f', 'm', 't', ' ',         // Subchunk 1 ID
        16, 0, 0, 0,                // Subchunk 1 size
        1, 0,                       // Audio format (linear PCM)
        2, 0,                       // Number of channels (stereo)
        SR[0], SR[1], SR[2], SR[3], // Sample rate
        BR[0], BR[1], BR[2], BR[3], // Byte rate (sample rate * 2 bytes/sample * 2 channels)
        4, 0,                       // Block alignment (2 bytes/sample * 2 channels)
        16, 0,                      // Bits per sample
        'd', 'a', 't', 'a',         // Subchunk 2 ID
        0xFF, 0xFF, 0xFF, 0xFF      // Subchunk 2 size: will fill in afterward
      });
      output->write(reinterpret_cast<char*>(riff.data()), riff.size());
    }

    std::cerr << _T("Decoding \"") << inputFilename << _T("\" to \"") << outputFilename << _T("\"...") << std::endl;
    std::vector<uint8_t> buf(sampleRate * 4);
    std::cerr << _T("Progress: 0 sec") << std::flush;

    signal(SIGINT, sighandler);
    signal(SIGTERM, sighandler);

    unsigned int samplesWritten = 0;
    unsigned int bytesWritten = 0;
    double seconds = 0;
    bool skipSilence = true;
    unsigned int samplesPerStep = sampleRate / 256;
    int silenceRemaining = sampleRate * 10;
    while (!stopNow && !done) {
      for (unsigned int i = 0; i < sampleRate; i += samplesPerStep) {
        samplesWritten = 0;
        done = player.FillBuffer(buf, samplesWritten);
        if (skipSilence) {
          for (unsigned int j = 0; j < samplesWritten * 4; j += 4) {
            if (buf[j] != 0 || buf[j+1] != 0 || buf[j+2] != 0 || buf[j+3] != 0) {
              skipSilence = false;
              samplesPerStep = sampleRate;
              break;
            }
          }
          if (skipSilence) {
            silenceRemaining -= samplesWritten;
            if (silenceRemaining <= 0) {
              skipSilence = false;
            }
            continue;
          }
        }
        output->write(reinterpret_cast<char*>(buf.data()), (samplesWritten * 4));
        bytesWritten += samplesWritten * 4;
      }
      seconds = bytesWritten / (sampleRate * 4.0);
      std::cerr << _T("\rProgress: ") << seconds << _T(" sec") << std::flush;
    };
    std::cerr << std::endl;

    if (!raw) {
      if (foutput) {
        foutput->seekp(40, std::ios::beg);
      }
      if (!foutput || foutput->fail()) {
        std::cerr << _T("\nWarning: output is not seekable, WAVE header will have incorrect length") << std::endl;
      } else {
        // stream is seekable
        // if it's not, then we just have to let the other end of the pipe deal with it
        std::vector<uint8_t> sizeBytes({
          uint8_t((bytesWritten) & 0xFF),
          uint8_t((bytesWritten >> 8) & 0xFF),
          uint8_t((bytesWritten >> 16) & 0xFF),
          uint8_t(bytesWritten >> 24)
        });
        foutput->write(reinterpret_cast<char*>(sizeBytes.data()), 4);

        bytesWritten += 36;
        sizeBytes = std::vector<uint8_t>({
          uint8_t((bytesWritten) & 0xFF),
          uint8_t((bytesWritten >> 8) & 0xFF),
          uint8_t((bytesWritten >> 16) & 0xFF),
          uint8_t(bytesWritten >> 24)
        });
        foutput->seekp(4, std::ios::beg);
        foutput->write(reinterpret_cast<char*>(sizeBytes.data()), 4);
      }
    }
    if (foutput) foutput->close();

    std::cerr << _T("Done! Wrote ") << bytesWritten << _T(" bytes.") << std::endl;
  } catch (std::exception & e) {
    std::cerr << _T("Error: ") << e.what() << std::endl;
    return 1;
  }

  return 0;
}
