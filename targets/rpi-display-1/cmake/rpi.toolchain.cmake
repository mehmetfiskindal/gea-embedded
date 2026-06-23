# Cross-compile toolchain for Raspberry Pi Zero W v1.1 (32-bit ARMv6 hard-float)
#
# Usage:
#   cmake -DCMAKE_TOOLCHAIN_FILE=cmake/rpi.toolchain.cmake \
#         -DCMAKE_SYSROOT=/path/to/rpi-sysroot \
#         -S . -B build
#
# The sysroot is typically produced by extracting balenalib/raspberry-pi
# Docker image layers, or by rsync-ing an existing Pi's filesystem.

set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR arm)

# Cross compilers — adjust to match your sysroot toolchain.
set(CMAKE_C_COMPILER   "arm-linux-gnueabihf-gcc")
set(CMAKE_CXX_COMPILER "arm-linux-gnueabihf-g++")
set(CMAKE_AR           "arm-linux-gnueabihf-ar" CACHE FILEPATH "ar")
set(CMAKE_STRIP        "arm-linux-gnueabihf-strip" CACHE FILEPATH "strip")
set(CMAKE_RANLIB       "arm-linux-gnueabihf-ranlib" CACHE FILEPATH "ranlib")

if(NOT DEFINED CMAKE_SYSROOT OR CMAKE_SYSROOT STREQUAL "")
    message(WARNING "CMAKE_SYSROOT not set; using system compiler paths")
else()
    set(CMAKE_SYSROOT "${CMAKE_SYSROOT}")
    set(CMAKE_FIND_ROOT_PATH "${CMAKE_SYSROOT}")
    set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
    set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
    set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
endif()

# Pi Zero needs PIE relocations and a 32-bit ARM architecture target.
# -static-libgcc prevents the host toolchain's libgcc.a (typically built
# for ARMv7) from being pulled in and tagging the final ELF as v7.
set(CMAKE_C_FLAGS_INIT   "-march=armv6zk -mfpu=vfp -mfloat-abi=hard -static-libgcc -pthread")
set(CMAKE_CXX_FLAGS_INIT "-march=armv6zk -mfpu=vfp -mfloat-abi=hard -static-libgcc -pthread")
set(CMAKE_SHARED_LINKER_FLAGS_INIT   "-static-libgcc")
set(CMAKE_EXE_LINKER_FLAGS_INIT      "-static-libgcc")
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(CMAKE_SYSROOT)
    set(CMAKE_C_FLAGS_INIT   "${CMAKE_C_FLAGS_INIT} -B${CMAKE_SYSROOT}/usr/lib/arm-linux-gnueabihf -B${CMAKE_SYSROOT}/lib/arm-linux-gnueabihf -L${CMAKE_SYSROOT}/usr/lib/arm-linux-gnueabihf -L${CMAKE_SYSROOT}/lib/arm-linux-gnueabihf -isystem ${CMAKE_SYSROOT}/usr/include/arm-linux-gnueabihf")
    set(CMAKE_CXX_FLAGS_INIT "${CMAKE_CXX_FLAGS_INIT} -B${CMAKE_SYSROOT}/usr/lib/arm-linux-gnueabihf -B${CMAKE_SYSROOT}/lib/arm-linux-gnueabihf -L${CMAKE_SYSROOT}/usr/lib/arm-linux-gnueabihf -L${CMAKE_SYSROOT}/lib/arm-linux-gnueabihf -isystem ${CMAKE_SYSROOT}/usr/include/arm-linux-gnueabihf")

    set(CMAKE_EXE_LINKER_FLAGS_INIT    "-Wl,-rpath-link,${CMAKE_SYSROOT}/usr/lib/arm-linux-gnueabihf -Wl,-rpath-link,${CMAKE_SYSROOT}/lib/arm-linux-gnueabihf")
    set(CMAKE_SHARED_LINKER_FLAGS_INIT "-Wl,-rpath-link,${CMAKE_SYSROOT}/usr/lib/arm-linux-gnueabihf -Wl,-rpath-link,${CMAKE_SYSROOT}/lib/arm-linux-gnueabihf")

    # Fedora cross-compiler specs fix: link against Fedora's host-side cross glibc sysroot for Fedora-specific helper libraries.
    if(EXISTS "/usr/arm-linux-gnueabihf/sys-root/lib")
        set(CMAKE_C_FLAGS_INIT   "${CMAKE_C_FLAGS_INIT} -L/usr/arm-linux-gnueabihf/sys-root/lib")
        set(CMAKE_CXX_FLAGS_INIT "${CMAKE_CXX_FLAGS_INIT} -L/usr/arm-linux-gnueabihf/sys-root/lib")
    endif()
endif()

