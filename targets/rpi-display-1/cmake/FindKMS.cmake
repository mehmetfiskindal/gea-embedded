# Locate libdrm (KMS backend for Pi 3/4/5 and recent Zero firmware)
# Defines:
#   KMS_FOUND
#   KMS_INCLUDE_DIRS
#   KMS_LIBRARIES
#   DRM_HEADERS_OK — when libdrm/drm.h, libdrm_mode.h are present

find_path(KMS_INCLUDE_DIR
    NAMES libdrm/libdrm.h
    PATHS /usr/include /usr/local/include
)
find_library(KMS_LIBRARY
    NAMES drm
    PATHS /usr/lib /usr/lib/arm-linux-gnueabihf /usr/local/lib
)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(KMS
    DEFAULT_MSG KMS_LIBRARY KMS_INCLUDE_DIR
)

if(KMS_FOUND)
    set(KMS_LIBRARIES ${KMS_LIBRARY})
    set(KMS_INCLUDE_DIRS ${KMS_INCLUDE_DIR})

    # Verify the mode headers we need are present.
    if(EXISTS "${KMS_INCLUDE_DIR}/libdrm/drm.h" AND
       EXISTS "${KMS_INCLUDE_DIR}/libdrm/libdrm_mode.h")
        set(DRM_HEADERS_OK TRUE)
    endif()
endif()

mark_as_advanced(KMS_INCLUDE_DIR KMS_LIBRARY)
