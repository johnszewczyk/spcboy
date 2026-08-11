/*
 * xSF - NCSF Player
 * By Naram Qashat (CyberBotX) [cyberbotx@cyberbotx.com]
 * Last modification on 2014-10-18
 *
 * Partially based on the vio*sf framework
 *
 * Utilizes a modified FeOS Sound System for playback
 * https://github.com/fincs/FSS
 */

#pragma once

#include <memory>
#include <zlib.h>
#include "convert.h"
#include "XSFPlayer.h"
#include "XSFCommon.h"

class XSFPlayer_2SF : public XSFPlayer
{
    std::vector<uint8_t> rom;
    bool enableJIT;
    bool isStdin;

    void Map2SFSection(const std::vector<uint8_t> &section);
    bool Map2SF(XSFFile *xSFToLoad);
    bool RecursiveLoad2SF(XSFFile *xSFToLoad, int level);
    bool Load2SF(XSFFile *xSFToLoad);
public:
    enum InterpolationMode {
      IM_None = 0,
      IM_Linear = 1,
      IM_Cosine = 2,
      IM_Sharp = 3
    };

    XSFPlayer_2SF(const std::string &filename);
#ifdef _WIN32
    XSFPlayer_2SF(const std::wstring &filename);
#endif
    ~XSFPlayer_2SF() { this->Terminate(); }
    bool Load(int frameSkip = -1);
    void GenerateSamples(std::vector<uint8_t> &buf, unsigned offset, unsigned samples);
    void Terminate();

    void SetInterpolationMode(InterpolationMode mode);
    void EnableJIT();
};
