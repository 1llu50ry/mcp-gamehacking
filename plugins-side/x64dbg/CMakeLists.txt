cmake_minimum_required(VERSION 3.15)
project(mcp_x64dbg_bridge CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Point X64DBG_SDK at the x64dbg pluginsdk directory:
#   cmake -S . -B build -A x64 -DX64DBG_SDK=C:/x64dbg/release/x64/plugins/sdk
#   cmake --build build --config Release
#
# For x32 build, use -A Win32 and point X64DBG_SDK at the x32 sdk dir.
if(NOT DEFINED X64DBG_SDK)
    message(FATAL_ERROR "Set X64DBG_SDK to the plugins/sdk directory of your x64dbg install")
endif()

add_library(mcp_bridge SHARED mcp_bridge.cpp)
set_target_properties(mcp_bridge PROPERTIES
    OUTPUT_NAME "mcp_bridge"
    PREFIX ""
    SUFFIX $<IF:$<EQUAL:${CMAKE_SIZEOF_VOID_P},8>,".dp64",".dp32">
)

target_include_directories(mcp_bridge PRIVATE "${X64DBG_SDK}")
target_link_directories(mcp_bridge PRIVATE "${X64DBG_SDK}")

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    target_link_libraries(mcp_bridge PRIVATE x64dbg x64bridge ws2_32)
else()
    target_link_libraries(mcp_bridge PRIVATE x32dbg x32bridge ws2_32)
endif()

if(MSVC)
    target_compile_options(mcp_bridge PRIVATE /W4 /permissive-)
endif()
