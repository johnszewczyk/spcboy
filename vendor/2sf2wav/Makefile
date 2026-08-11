ifeq ($(OS),Windows_NT)
	WINDOWS := 1
else ifneq ($(findstring mingw,$(CXX)),)
	WINDOWS := 1
ifeq ($(findstring mingw,$(CC)),)
	CC := $(subst g++,gcc,$(CXX))
endif
else
	WINDOWS := 0
endif

ifeq ($(WINDOWS),1)
all: 2sf2wav.exe
CXXFLAGS += -D_WINDOWS -mmmx -msse -msse2 -isystem zlib
CFLAGS += -D_WINDOWS -mmmx -msse -msse2
else
CXXFLAGS += $(shell pkg-config --cflags zlib)
all: 2sf2wav
endif

HEADERS = $(wildcard desmume/*.h sseqplayer/*.h spu/*.h *.h)
SOURCES = $(wildcard desmume/*/*/*/*.cpp desmume/*/*/*.cpp desmume/*/*.cpp desmume/*.cpp sseqplayer/*.cpp spu/*.cpp *.cpp)
OBJECTS = $(patsubst %.cpp, %.o, $(SOURCES))
CORE_SOURCES = $(filter-out main.cpp desmume/arm_jit.cpp desmume/utils/AsmJit/%,$(SOURCES))
CORE_OBJECTS = $(patsubst %.cpp, %.o, $(CORE_SOURCES))
ZLIB_SRCS = $(wildcard zlib/*.c)
ZLIB_OBJS = $(patsubst %.c, %.o, $(ZLIB_SRCS))

%.o: %.c
	$(CC) -O3 $(CFLAGS) -c -o $@ $<

%.o: %.cpp $(HEADERS) Makefile
	$(CXX) -std=gnu++14 -O3 $(CXXFLAGS) -c -I. -Idesmume/ -Isseqplayer/ -fpermissive -o $@ $<

2sf2wav: $(OBJECTS)
	$(CXX) -o $@ $^ $(shell pkg-config --libs zlib)
ifneq ($(STRIP),)
	$(STRIP) $@
endif

lib2sf.a: $(CORE_OBJECTS)
	ar rcs $@ $^

2sf2wav.exe: $(OBJECTS) $(ZLIB_OBJS)
	$(CXX) -o $@ -municode -static -static-libstdc++ -static-libgcc $^
ifneq ($(STRIP),)
	$(STRIP) $@
endif

clean:
	rm -f 2sf2wav 2sf2wav.exe *.o sseqplayer/*.o spu/*.o desmume/*.o desmume/metaspu/*.o desmume/addons/*.o desmume/utils/*.o desmume/utils/AsmJit/base/*.o desmume/utils/AsmJit/x86/*.o
