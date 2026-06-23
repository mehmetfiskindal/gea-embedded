# Locate libinput + libudev (optional input backend for Pi 3/4/5)
# evdev is the primary backend on Pi Zero W v1.1 (zero deps).

find_path(LIBINPUT_INCLUDE_DIR
    NAMES libinput.h
    PATHS /usr/include /usr/local/include
)
find_library(LIBINPUT_LIBRARY
    NAMES input
    PATHS /usr/lib /usr/lib/arm-linux-gnueabihf /usr/local/lib
)
find_library(UDEV_LIBRARY
    NAMES udev
    PATHS /usr/lib /usr/lib/arm-linux-gnueabihf /usr/local/lib
)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(LibInput
    DEFAULT_MSG LIBINPUT_LIBRARY LIBINPUT_INCLUDE_DIR
)

if(LIBINPUT_FOUND)
    set(LIBINPUT_LIBRARIES ${LIBINPUT_LIBRARY})
    if(UDEV_LIBRARY)
        list(APPEND LIBINPUT_LIBRARIES ${UDEV_LIBRARY})
    endif()
    set(LIBINPUT_INCLUDE_DIRS ${LIBINPUT_INCLUDE_DIR})
endif()

mark_as_advanced(LIBINPUT_INCLUDE_DIR LIBINPUT_LIBRARY UDEV_LIBRARY)
