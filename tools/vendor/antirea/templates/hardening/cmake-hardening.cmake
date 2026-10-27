# antirea — CMake release hardening
#
# Include in your CMakeLists.txt:
#   include(scripts/cmake-hardening.cmake)
#
# Or pass as a toolchain file:
#   cmake -DCMAKE_TOOLCHAIN_FILE=scripts/cmake-hardening.cmake ..

# -------------------------------------------------------------------------
# Require Release build for distribution
# -------------------------------------------------------------------------
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# -------------------------------------------------------------------------
# Strip debug info and hide symbols (GCC / Clang)
# -------------------------------------------------------------------------
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang" OR CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")

  # Hide all symbols by default — only explicitly exported ones are visible
  # REA's binary_overview and analyze_function only see your public API
  add_compile_options(-fvisibility=hidden)
  add_compile_options(-fvisibility-inlines-hidden)

  # No debug information in release
  set(CMAKE_C_FLAGS_RELEASE   "${CMAKE_C_FLAGS_RELEASE}   -O2 -DNDEBUG -g0")
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O2 -DNDEBUG -g0")

  # Strip binary after linking
  set(CMAKE_EXE_LINKER_FLAGS_RELEASE    "${CMAKE_EXE_LINKER_FLAGS_RELEASE}    -Wl,--strip-all")
  set(CMAKE_SHARED_LINKER_FLAGS_RELEASE "${CMAKE_SHARED_LINKER_FLAGS_RELEASE} -Wl,--strip-all")

  # Remove unused sections (reduces surface area for REA string analysis)
  set(CMAKE_EXE_LINKER_FLAGS_RELEASE    "${CMAKE_EXE_LINKER_FLAGS_RELEASE}    -Wl,--gc-sections")
  set(CMAKE_SHARED_LINKER_FLAGS_RELEASE "${CMAKE_SHARED_LINKER_FLAGS_RELEASE} -Wl,--gc-sections")
  add_compile_options(-ffunction-sections -fdata-sections)

endif()

# -------------------------------------------------------------------------
# MSVC hardening
# -------------------------------------------------------------------------
if(MSVC)
  # Optimization + no debug info in distribution
  set(CMAKE_C_FLAGS_RELEASE   "${CMAKE_C_FLAGS_RELEASE}   /O2 /GL /DNDEBUG")
  set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /O2 /GL /DNDEBUG")

  # Link-time code generation + dead code elimination
  set(CMAKE_EXE_LINKER_FLAGS_RELEASE    "${CMAKE_EXE_LINKER_FLAGS_RELEASE}    /LTCG /OPT:REF /OPT:ICF")
  set(CMAKE_SHARED_LINKER_FLAGS_RELEASE "${CMAKE_SHARED_LINKER_FLAGS_RELEASE} /LTCG /OPT:REF /OPT:ICF")

  # Do NOT generate PDB for distribution
  # (PDB gives REA perfect symbol information)
  # Use /Z7 internally for CI symbol storage only, never distribute
  string(REPLACE "/Zi" "" CMAKE_C_FLAGS_RELEASE   "${CMAKE_C_FLAGS_RELEASE}")
  string(REPLACE "/Zi" "" CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE}")
  string(REPLACE "/ZI" "" CMAKE_C_FLAGS_RELEASE   "${CMAKE_C_FLAGS_RELEASE}")
  string(REPLACE "/ZI" "" CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE}")
endif()

# -------------------------------------------------------------------------
# Post-build strip step (Linux/macOS)
# -------------------------------------------------------------------------
# Call antirea_strip_target(your_target) after add_executable / add_library
macro(antirea_strip_target TARGET_NAME)
  if(CMAKE_STRIP)
    add_custom_command(TARGET ${TARGET_NAME} POST_BUILD
      COMMAND ${CMAKE_STRIP}
        $<$<PLATFORM_ID:Linux>:--strip-all>
        $<$<PLATFORM_ID:Darwin>:-x>
        $<TARGET_FILE:${TARGET_NAME}>
      COMMENT "[antirea] Stripping ${TARGET_NAME}"
    )
  endif()
endmacro()

# -------------------------------------------------------------------------
# Reminder message
# -------------------------------------------------------------------------
message(STATUS "[antirea] CMake hardening loaded.")
message(STATUS "[antirea] Call antirea_strip_target(<target>) after each add_executable/add_library.")
message(STATUS "[antirea] Ensure .re-deny and AGENTS.md are present in the project root.")